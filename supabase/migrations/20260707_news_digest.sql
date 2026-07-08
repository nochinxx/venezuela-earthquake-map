-- Daily news digest table — populated by scrapers/news_digest.py via Gemma 4
-- Apply in Supabase SQL editor: https://supabase.com/dashboard/project/pjvzoacewosymllnejcr/sql

CREATE TABLE IF NOT EXISTS news_digest (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  digest_date      date NOT NULL UNIQUE,           -- one row per day
  deaths_confirmed int,
  injuries_confirmed int,
  infrastructure   text,                           -- brief infrastructure status
  gov_response     text,                           -- government actions summary
  key_events       text[] NOT NULL DEFAULT '{}',  -- 3-5 bullet points ES
  key_events_en    text[] NOT NULL DEFAULT '{}',  -- same bullets EN
  es_summary       text NOT NULL DEFAULT '',       -- 2-3 sentence ES digest
  en_summary       text NOT NULL DEFAULT '',       -- 2-3 sentence EN digest
  sources          text[] NOT NULL DEFAULT '{}',  -- source URLs included in digest
  raw_articles     jsonb NOT NULL DEFAULT '[]',   -- raw feed items for audit
  generated_at     timestamptz DEFAULT now()
);

-- RLS: public read, service-role write
ALTER TABLE news_digest ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON news_digest FOR SELECT TO anon USING (true);
CREATE POLICY "service_write" ON news_digest FOR ALL TO service_role USING (true);

-- Index for fast latest-first queries
CREATE INDEX IF NOT EXISTS nd_date_idx ON news_digest(digest_date DESC);

-- Verify:
-- SELECT digest_date, deaths_confirmed, es_summary FROM news_digest ORDER BY digest_date DESC LIMIT 5;
