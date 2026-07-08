CREATE TABLE IF NOT EXISTS building_damage (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id     text,
  external_source text NOT NULL,
  lat             double precision NOT NULL,
  lng             double precision NOT NULL,
  place           text,
  damage_type     text,
  affected        integer,
  needs           text,
  photo_url       text,
  confirmations   integer DEFAULT 0,
  reported_at     timestamptz,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(external_source, external_id)
);
CREATE INDEX IF NOT EXISTS building_damage_source_idx ON building_damage(external_source);
CREATE INDEX IF NOT EXISTS building_damage_location_idx ON building_damage(lat, lng);
