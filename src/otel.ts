// OpenTelemetry: traces + error logs over OTLP gRPC to the stand collector.
//
// Defaults to otel-collector.rsk0-telemetry.svc:4317 (override with
// OTEL_EXPORTER_OTLP_ENDPOINT; disable with OTEL_SDK_DISABLED=true). Exporters are
// asynchronous and batched, so an unset/unreachable collector drops telemetry but
// never blocks or fails a request.
//
// No PII: spans/logs carry method, static route and status code only. Query
// strings are stripped from URL attributes; bodies and headers are never read.
import { context, trace, Context } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { Resource } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  ReadableSpan,
  Span,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { BatchLogRecordProcessor, LoggerProvider, LogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";

export const SERVICE_NAME = "payments-api";
const DEFAULT_ENDPOINT = "http://otel-collector.rsk0-telemetry.svc:4317";
const PROBE_PATHS = new Set(["/healthz", "/readyz", "/metrics"]);

const URL_KEYS = ["http.target", "http.url", "url.full", "url.path"];
const DROP_KEYS = ["url.query", "http.user_agent", "user_agent.original", "client.address", "net.peer.ip"];

function stripQuery(v: unknown): unknown {
  return typeof v === "string" ? v.split("?")[0].split("#")[0] : v;
}

/** "/charges/ch_123?x=1" -> "/charges": drops ids and query (they can carry user data). */
function coarsePath(p: string): string {
  return "/" + (p.split("?")[0].split("#")[0].split("/")[1] ?? "");
}

function coarseValue(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)(.*)$/i.exec(v);
  return m ? m[1] + coarsePath(m[2]) : coarsePath(v);
}

/** Removes query strings and client identifiers from spans before export. */
class ScrubProcessor implements SpanProcessor {
  onStart(): void {}
  onEnd(span: ReadableSpan): void {
    const attrs = span.attributes as Record<string, unknown>;
    for (const k of URL_KEYS) if (k in attrs) attrs[k] = coarseValue(attrs[k]);
    for (const k of DROP_KEYS) delete attrs[k];
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

/** Keep span names low-cardinality: "GET /charges" (ids and query dropped). */
class NameProcessor implements SpanProcessor {
  onStart(span: Span): void {
    const attrs = span.attributes as Record<string, unknown>;
    const target = attrs["http.target"] ?? attrs["url.path"];
    const method = attrs["http.method"] ?? attrs["http.request.method"];
    if (typeof target === "string" && typeof method === "string") {
      span.updateName(`${method} ${coarsePath(target)}`);
    }
  }
  onEnd(): void {}
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

export interface TelemetryOptions {
  /** Extra processors (tests inject in-memory ones); skips the OTLP exporters. */
  spanProcessors?: SpanProcessor[];
  logProcessors?: LogRecordProcessor[];
}

let shutdownFn: (() => Promise<void>) | undefined;

export function startTelemetry(opts: TelemetryOptions = {}): void {
  if ((process.env.OTEL_SDK_DISABLED ?? "").toLowerCase() === "true" || shutdownFn) return;
  try {
    const attrs: Record<string, string> = { "service.name": SERVICE_NAME };
    if (process.env.K8S_NAMESPACE) attrs["k8s.namespace.name"] = process.env.K8S_NAMESPACE;
    const resource = new Resource(attrs);
    const url = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? undefined : DEFAULT_ENDPOINT;

    const spanProcessors: SpanProcessor[] = [new NameProcessor(), new ScrubProcessor()];
    if (opts.spanProcessors) spanProcessors.push(...opts.spanProcessors);
    else spanProcessors.push(new BatchSpanProcessor(new OTLPTraceExporter({ url, timeoutMillis: 3000 })));
    const tp = new NodeTracerProvider({ resource, spanProcessors });
    tp.register();

    const logProcessors = opts.logProcessors ?? [
      new BatchLogRecordProcessor(new OTLPLogExporter({ url, timeoutMillis: 3000 })),
    ];
    const lp = new LoggerProvider({ resource });
    for (const proc of logProcessors) lp.addLogRecordProcessor(proc);
    logs.setGlobalLoggerProvider(lp);

    registerInstrumentations({
      tracerProvider: tp,
      instrumentations: [
        new HttpInstrumentation({
          ignoreIncomingRequestHook: (req) => PROBE_PATHS.has((req.url ?? "").split("?")[0]),
        }),
      ],
    });
    shutdownFn = async () => {
      await Promise.allSettled([tp.shutdown(), lp.shutdown()]);
    };
  } catch (err) {
    // Telemetry must never stop the service.
    // eslint-disable-next-line no-console
    console.error("payments-api: telemetry disabled:", (err as Error).message);
  }
}

export async function shutdownTelemetry(): Promise<void> {
  const fn = shutdownFn;
  shutdownFn = undefined;
  if (fn) await Promise.race([fn(), new Promise((r) => setTimeout(r, 3000).unref())]);
}

/** Error log for a 5xx: fixed message, status code and static route only. */
export function logServerError(ctx: Context, route: string, status: number): void {
  if (status < 500) return;
  try {
    logs.getLogger(SERVICE_NAME).emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: "request failed",
      attributes: { "http.response.status_code": status, "http.route": route },
      context: ctx,
    });
  } catch {
    // never affect the request
  }
}

export { context, trace };
