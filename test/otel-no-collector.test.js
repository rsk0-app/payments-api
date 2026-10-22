const { test } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

// No collector reachable (nothing listens on this port): the service must still serve.
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:1";
process.env.FAILURE_MODE = "errors";
process.env.ERROR_RATE = "1";
process.env.DATABASE_URL = "";

const { app } = require("../dist/index"); // registers real OTLP exporters via otel-register
const { shutdownTelemetry } = require("../dist/otel");

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ port, path }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); }).on("error", reject);
  });
}

test("serves (including injected 5xx) and shuts down with an unreachable collector", async () => {
  const server = app.listen(0);
  const port = server.address().port;
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) {
    assert.strictEqual(await get(port, "/charges"), 500);
    assert.strictEqual(await get(port, "/healthz"), 200);
  }
  assert.ok(Date.now() - t0 < 2000, "requests must not wait on the exporter");
  server.close();
  await shutdownTelemetry();
});
