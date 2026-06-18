import express from "express";
import { chargesRouter } from "./charges";
import { render } from "./metrics";

const app = express();
app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "payments-api" });
});

app.get("/metrics", (_req, res) => {
  res.type("text/plain").send(render());
});

app.use("/charges", chargesRouter);

const port = Number(process.env.PORT ?? 3000);
if (require.main === module) {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`payments-api listening on :${port}`);
  });
}

export { app };
