-- baseline: payments-api owns the charges table (R2 realistic-stand).
CREATE TABLE IF NOT EXISTS charges (
  id           text PRIMARY KEY,
  amount_cents integer NOT NULL,
  currency     text NOT NULL DEFAULT 'usd',
  status       text NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now()
);
