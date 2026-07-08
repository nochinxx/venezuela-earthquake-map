-- Relief centers: track last confirmation date for auto-expiry
-- Apply in Supabase SQL editor: https://supabase.com/dashboard/project/pjvzoacewosymllnejcr/sql

ALTER TABLE relief_centers
  ADD COLUMN IF NOT EXISTS last_confirmed_at timestamptz DEFAULT now();

-- Index for expiry queries (centers not confirmed in 7+ days)
CREATE INDEX IF NOT EXISTS rc_confirmed_idx ON relief_centers(last_confirmed_at);

-- Backfill existing records (assume confirmed when created)
UPDATE relief_centers
SET last_confirmed_at = COALESCE(last_confirmed_at, now())
WHERE last_confirmed_at IS NULL;

-- Verify:
-- SELECT name, state, last_confirmed_at FROM relief_centers ORDER BY last_confirmed_at DESC LIMIT 10;
