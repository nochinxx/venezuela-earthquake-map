-- Missing persons data quality improvements — Phase 2
-- Apply in Supabase SQL editor: https://supabase.com/dashboard/project/pjvzoacewosymllnejcr/sql

-- 1. Staleness tracking — when was this record last confirmed/updated from its source?
ALTER TABLE missing_persons
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz;

-- 2. Audit trail — every status change appends an entry here
--    Format: [{"status": "sin-contacto", "changed_at": "...", "changed_by": "scraper", "source": "desaparecidos-vzla"}, ...]
ALTER TABLE missing_persons
  ADD COLUMN IF NOT EXISTS status_history jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3. Index for staleness queries (surface records not verified in 7+ days)
CREATE INDEX IF NOT EXISTS mp_last_verified_idx ON missing_persons(last_verified_at NULLS FIRST);

-- 4. Backfill last_verified_at from submitted_at for existing records
UPDATE missing_persons
SET last_verified_at = submitted_at
WHERE last_verified_at IS NULL AND submitted_at IS NOT NULL;

-- 5. Trigger: auto-append to status_history on every status change
CREATE OR REPLACE FUNCTION mp_track_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.status_history := NEW.status_history || jsonb_build_object(
      'from',       OLD.status,
      'to',         NEW.status,
      'changed_at', now(),
      'source',     NEW.external_source
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mp_status_history_trigger ON missing_persons;
CREATE TRIGGER mp_status_history_trigger
  BEFORE UPDATE ON missing_persons
  FOR EACH ROW EXECUTE FUNCTION mp_track_status_change();

-- 6. RLS: cedula and contact_info must never be readable by anon key
--    Approach: use a security-definer view that strips sensitive columns,
--    then point public API to the view instead of the table directly.
--    (Wire up in API routes after applying this migration)

-- Verify the new columns exist:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'missing_persons' AND column_name IN ('last_verified_at', 'status_history');
