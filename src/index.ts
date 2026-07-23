import express from "express";
import { chargesRouter } from "./charges";
import { register, instrument, maybeCrash } from "./metrics";

const app = express();
app.use(express.json());

// Health and metrics are registered BEFORE the failure-injecting middleware so
// they always work and are never failure-injected.
app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "payments-api" });
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
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`payments-api listening on :${port}`);
  });
}

export { app };
