const { test, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

process.env.FAILURE_MODE = "errors"; // existing knob: genuine injected 5xx
process.env.ERROR_RATE = "1";
process.env.DATABASE_URL = "";
process.env.K8S_NAMESPACE = "prod";

const { SimpleSpanProcessor, InMemorySpanExporter } = require("@opentelemetry/sdk-trace-node");
const { SimpleLogRecordProcessor, InMemoryLogRecordExporter } = require("@opentelemetry/sdk-logs");
const { SpanKind, SpanStatusCode } = require("@opentelemetry/api");
const { SeverityNumber } = require("@opentelemetry/api-logs");

const spans = new InMemorySpanExporter();
const logRecords = new InMemoryLogRecordExporter();
// Must run before express is loaded so http is instrumented.
const otel = require("../dist/otel");
otel.startTelemetry({
  spanProcessors: [new SimpleSpanProcessor(spans)],
  logProcessors: [new SimpleLogRecordProcessor(logRecords)],
});
const { app } = require("../dist/index");

function get(port, path) {
  return new Promise((resolve, reject) => {
    http
      .get({ port, path, headers: { authorization: "Bearer secret-token" } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      })
      .on("error", reject);
  });
}

test("5xx produces an error-level log record and an error SERVER span, without PII", async () => {
  const server = app.listen(0);
  after(() => server.close());
  const status = await get(server.address().port, "/charges/abc?email=a@b.c&token=secret");
  assert.strictEqual(status, 500);
  await new Promise((r) => setTimeout(r, 50));

  const serverSpans = spans.getFinishedSpans().filter((s) => s.kind === SpanKind.SERVER);
  assert.strictEqual(serverSpans.length, 1);
  assert.strictEqual(serverSpans[0].status.code, SpanStatusCode.ERROR);
  assert.strictEqual(serverSpans[0].resource.attributes["service.name"], "payments-api");
  assert.strictEqual(serverSpans[0].resource.attributes["k8s.namespace.name"], "prod");

  const recs = logRecords.getFinishedLogRecords();
  assert.strictEqual(recs.length, 1);
  assert.strictEqual(recs[0].severityNumber, SeverityNumber.ERROR);
  assert.strictEqual(recs[0].body, "request failed");
  assert.strictEqual(recs[0].attributes["http.response.status_code"], 500);
  assert.strictEqual(recs[0].spanContext.traceId, serverSpans[0].spanContext().traceId);

  const dump = JSON.stringify([
    serverSpans.map((s) => [s.name, s.attributes]),
    recs.map((r) => [r.body, r.attributes]),
  ]);
  for (const bad of ["secret", "a@b.c", "email", "token", "abc", "authorization"]) {
    assert.ok(!dump.toLowerCase().includes(bad.toLowerCase()), `leaked ${bad}: ${dump}`);
  }
});

test("probes are not traced", async () => {
  spans.reset();
  const server = app.listen(0);
  after(() => server.close());
  await get(server.address().port, "/healthz");
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(spans.getFinishedSpans().filter((s) => s.kind === SpanKind.SERVER).length, 0);
});
