// Imported FIRST by index.ts so http is instrumented before express loads it.
import { startTelemetry } from "./otel";

startTelemetry();
