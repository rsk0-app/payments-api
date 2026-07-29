-- migration: change (targets payments-api's own table; runs after the baseline)
ALTER TABLE charges ADD COLUMN IF NOT EXISTS stand_marker text;
