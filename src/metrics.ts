import type { Request, Response, NextFunction, RequestHandler } from "express";
import client, { Counter, Histogram, Registry } from "prom-client";
import { recordFootprint } from "./footprint";

/** Prometheus registry with default (process) metrics enabled. */
export const register = new Registry();
client.collectDefaultMetrics({ register });

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests processed, labeled by route and status code.",
  labelNames: ["route", "code"] as const,
  registers: [register],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds, labeled by route.",
  labelNames: ["route"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

/** Lazily-created business counters for the legacy `inc()` helper. */
const businessCounters = new Map<string, Counter>();

/** Legacy counter helper kept for existing call sites (e.g. charges router). */
export function inc(name: string, by = 1): void {
  let counter = businessCounters.get(name);
  if (!counter) {
    counter = new Counter({ name, help: name, registers: [register] });
    businessCounters.set(name, counter);
  }
  counter.inc(by);
}

/** Record a completed request: bumps the counter and observes the duration. */
export function record(route: string, code: number | string, startNs: bigint): void {
  const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
  httpRequestsTotal.inc({ route, code: String(code) });
  httpRequestDurationSeconds.observe({ route }, durationSeconds);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Express middleware factory. Wraps a route with the configured failure
 * injector (errors / latency) and records metrics on response finish.
 */
export function instrument(route: string): RequestHandler {
  return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startNs = process.hrtime.bigint();
    const mode = process.env.FAILURE_MODE ?? "";
    const errorRate = Number(process.env.ERROR_RATE ?? "0.5");
    const latencyMs = Number(process.env.LATENCY_MS ?? "1500");

    res.on("finish", () => {
      record(route, res.statusCode, startNs);
    });

    // R3: accumulate the real, bounded memory footprint on the business path
    // (this middleware runs AFTER /healthz, /metrics and /readyz are registered,
    // so probes never contribute). Under load RSS plateaus at ~MEM_FOOTPRINT_MB.
    recordFootprint();

    if (mode === "errors" && Math.random() < errorRate) {
      res.status(500).send("injected failure");
      return;
    }

    if (mode === "latency") {
      await sleep(latencyMs);
    }

    next();
  };
}

/**
 * If FAILURE_MODE==="crash", schedule a hard process exit after
 * CRASH_AFTER_SEC (default 3) seconds. Call once at startup.
 */
export function maybeCrash(): void {
  if ((process.env.FAILURE_MODE ?? "") !== "crash") return;
  const afterSec = Number(process.env.CRASH_AFTER_SEC ?? "3");
  setTimeout(() => {
    // eslint-disable-next-line no-console
    console.error(`injected crash: exiting after ${afterSec}s`);
    process.exit(1);
  }, afterSec * 1000).unref();
}
