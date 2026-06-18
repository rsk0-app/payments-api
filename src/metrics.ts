/** Tiny in-process counter registry — Prometheus exposition format. */
const counters = new Map<string, number>();

export function inc(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function render(): string {
  return [...counters.entries()]
    .map(([name, value]) => `# TYPE ${name} counter\n${name} ${value}`)
    .join("\n");
}
