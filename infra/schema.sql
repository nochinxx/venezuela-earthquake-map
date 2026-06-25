-- Venezuela Earthquake Map — Supabase schema
-- Run this in the Supabase SQL editor after enabling PostGIS

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source        text NOT NULL CHECK (source IN ('twitter', 'instagram', 'youtube')),
  source_url    text UNIQUE NOT NULL,
  source_id     text,
  author        text,
  text_content  text,
  media_urls    text[]  DEFAULT '{}',
  lat           double precision,
  lng           double precision,
  location_name text,
  damage_level  int CHECK (damage_level BETWEEN 1 AND 5),
  post_time     timestamptz,
  scraped_at    timestamptz NOT NULL DEFAULT now(),
  verified      boolean NOT NULL DEFAULT false,
  geom          geography(Point, 4326)
);

-- Spatial index for heatmap queries
CREATE INDEX IF NOT EXISTS reports_geom_idx  ON reports USING GIST(geom);
CREATE INDEX IF NOT EXISTS reports_time_idx  ON reports(post_time DESC);
CREATE INDEX IF NOT EXISTS reports_source_idx ON reports(source);

-- Auto-compute geom from lat/lng on insert/update
CREATE OR REPLACE FUNCTION sync_geom()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reports_sync_geom
  BEFORE INSERT OR UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION sync_geom();

-- Public read access (no auth needed to view the map)
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read" ON reports
  FOR SELECT USING (true);

CREATE POLICY "service_role_write" ON reports
  FOR ALL USING (auth.role() = 'service_role');

-- Moderation columns (run ALTER if table already exists)
-- ALTER TABLE reports ADD COLUMN IF NOT EXISTS flag_count integer NOT NULL DEFAULT 0;
-- ALTER TABLE reports ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

-- Casualty statistics from verified sources
CREATE TABLE IF NOT EXISTS casualty_stats (
  id          serial PRIMARY KEY,
  deaths      integer,
  injured     integer,
  missing     integer,
  source_name text NOT NULL,
  source_url  text,
  auto_extracted boolean NOT NULL DEFAULT true,
  scraped_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE casualty_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_stats" ON casualty_stats
  FOR SELECT USING (true);

CREATE POLICY "service_role_write_stats" ON casualty_stats
  FOR ALL USING (auth.role() = 'service_role');
