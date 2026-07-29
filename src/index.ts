import express from "express";
import { chargesRouter } from "./charges";
import { register, instrument, maybeCrash } from "./metrics";
import { runMigrations, dbHealthy } from "./db";

const app = express();
app.use(express.json());

// Health and metrics are registered BEFORE the failure-injecting middleware so
// they always work and are never failure-injected.
app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "payments-api" });
});

// DEEP readiness probe. payments-api is the LEAF of the dependency chain (no
// downstream), so R2 readiness == a real DB check: 200 only if SELECT 1 succeeds
// (cheap, ~500ms cap). A broken DB flips this pod NotReady -> the upstream callers
// (orders-service, then checkout-web) chain their /readyz deep-checks against it,
// so the cascade propagates all the way up. DB disabled (local) => shallow 200.
// Registered before the failure-injecting middleware so it is never failure-injected.
app.get("/readyz", async (_req, res) => {
  if (await dbHealthy()) {
    res.json({ status: "ready", service: "payments-api" });
    return;
  }
  res.status(503).json({ status: "db unavailable", service: "payments-api" });
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.send(await register.metrics());
});

// Instrument + failure-inject every remaining request (loadgen traffic to any
// path is counted under route "all").
app.use(instrument("all"));

app.use("/charges", chargesRouter);

// Catch-all so traffic to any other path is still counted / failure-injected.
app.use((_req, res) => {
  res.json({ status: "ok", service: "payments-api" });
});

const port = Number(process.env.PORT ?? 3000);
if (require.main === module) {
  maybeCrash();
  // Run migrations BEFORE serving. A failing migration rejects here and exits
  // non-zero, so a bad migration really breaks the deploy (the modeled risk).
  runMigrations()
    .then(() => {
      app.listen(port, () => {
        // eslint-disable-next-line no-console
        console.log(`payments-api listening on :${port}`);
      });
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("payments-api: startup failed (migrations):", err);
      process.exit(1);
    });
}

export { app };
