-- migration: change
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stand_marker text;
