import express from "express";
import { chargesRouter } from "./charges";

const app = express();
app.use(express.json());

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "payments-api" });
});

app.use("/charges", chargesRouter);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`payments-api listening on :${port}`);
});

export { app };
