// R2 (realistic-stand): real Postgres client + migration runner.
//
// DATABASE_URL empty  => DB disabled, callers fall back to the in-memory store
//                        (so local/unit runs need no Postgres).
// DATABASE_URL set     => real `pg` pool; migrations applied on startup; the
//                        business path does a real write+read; /readyz SELECT 1s.
//
// A migration that throws is NOT swallowed — runMigrations() rejects and startup
// exits non-zero, so a bad migration really breaks the deploy (the modeled risk).

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { Pool } from "pg";

const MIGRATIONS_DIR = join(process.cwd(), "migrations");

let pool: Pool | null = null;

export function dbEnabled(): boolean {
  return (process.env.DATABASE_URL ?? "").trim() !== "";
}

export function getPool(): Pool | null {
  if (!dbEnabled()) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 3000,
    });
  }
  return pool;
}

/**
 * Lightweight readiness check: SELECT 1 with a ~500ms cap so probes never hammer
 * Postgres. DB disabled => true (not a blocker). Any error/timeout => false.
 */
export async function dbHealthy(): Promise<boolean> {
  const p = getPool();
  if (!p) return true;
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("db check timeout")), 500),
    );
    await Promise.race([p.query("SELECT 1"), timeout]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply every migrations/*.sql in lexical order, each in its own transaction,
 * recording applied files in schema_migrations so re-runs skip them. Throws (=>
 * process exits non-zero) on the first failing migration.
 */
export async function runMigrations(): Promise<void> {
  if (!dbEnabled()) {
    console.log("payments-api: DATABASE_URL not set — DB disabled, using in-memory store");
    return;
  }
  const p = getPool()!;
  await p.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename text primary key,
       applied_at timestamptz not null default now()
     )`,
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const { rows } = await p.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [file]);
    if (rows.length > 0) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`payments-api: applied migration ${file}`);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
}

export interface DbCharge {
  id: string;
  amount_cents: number;
  currency: string;
  status: string;
  created_at: string;
}

/** Real write+read against the charges table: INSERT then SELECT it back. */
export async function dbCreateCharge(amountCents: number, currency: string): Promise<DbCharge> {
  const p = getPool()!;
  const id = randomUUID();
  await p.query(
    "INSERT INTO charges (id, amount_cents, currency, status) VALUES ($1, $2, $3, 'pending')",
    [id, amountCents, currency],
  );
  const { rows } = await p.query(
    "SELECT id, amount_cents, currency, status, created_at FROM charges WHERE id = $1",
    [id],
  );
  if (rows.length === 0) throw new Error("charge not found after insert");
  return rows[0] as DbCharge;
}

export async function dbGetCharge(id: string): Promise<DbCharge | null> {
  const p = getPool()!;
  const { rows } = await p.query(
    "SELECT id, amount_cents, currency, status, created_at FROM charges WHERE id = $1",
    [id],
  );
  return (rows[0] as DbCharge) ?? null;
}

/** Returns the updated row, "already" if it was already captured, or null if missing. */
export async function dbCaptureCharge(id: string): Promise<DbCharge | "already" | null> {
  const p = getPool()!;
  const existing = await dbGetCharge(id);
  if (!existing) return null;
  if (existing.status === "captured") return "already";
  const { rows } = await p.query(
    "UPDATE charges SET status = 'captured' WHERE id = $1 RETURNING id, amount_cents, currency, status, created_at",
    [id],
  );
  return rows[0] as DbCharge;
}
