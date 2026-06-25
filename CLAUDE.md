# SismoVenezuela — Agent Briefing

Real-time earthquake damage and missing persons map for the June 24, 2026 Venezuela earthquake (M7.1–7.5 near Yumare/La Guaira). Public at **sismovenezuela.com** (Vercel). Open source.

---

## Architecture

```
apps/web/          Next.js 15 (App Router) + Mapbox GL JS + Tailwind — deployed to Vercel
apps/api/          FastAPI + uvicorn — deployed to Railway (reports ingestion only)
scrapers/          Python scripts — run on Mario's machine via conda env "agent"
infra/schema.sql   Supabase schema (already applied to prod)
```

**DB:** Supabase project `pjvzoacewosymllnejcr` (postgres + PostGIS)

**Conda env:** All Python scripts run as `conda run -n agent python scrapers/<name>.py`

---

## Env files (gitignored)

### `apps/web/.env.local`
```
NEXT_PUBLIC_MAPBOX_TOKEN=<Mapbox public token>
NEXT_PUBLIC_SUPABASE_URL=https://pjvzoacewosymllnejcr.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

### `scrapers/.env`
```
SUPABASE_URL=https://pjvzoacewosymllnejcr.supabase.co
SUPABASE_SERVICE_KEY=<service role key>
```

### `apps/api/.env`
```
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
```

---

## Key Database Tables

### `missing_persons`
| Column | Notes |
|--------|-------|
| `id` | uuid PK |
| `name` | person name |
| `age` | nullable |
| `last_seen_location` | text |
| `lat`, `lng` | nullable float |
| `description` | text |
| `contact_info` | text |
| `photo_url` | nullable |
| `status` | `sin-contacto` / `localizado` / `encontrado` |
| `external_source` | platform label e.g. `desaparecidos-vzla`, `venezulatebusca`, `SismoVenezuela via Hospital X` |
| `source_id` | **original platform ID** — NEVER overwrite this on update. It's the deep-link key back to desaparecidosterremotovenezuela.com (`?persona=<source_id>`) |
| `source2_url` | URL of tweet/post that confirmed the person as located (set by match_hospital_list.py) |
| `is_duplicate` | bool — cross-platform dedup flag. All queries must include `.or("is_duplicate.eq.false,is_duplicate.is.null")` |
| `submitted_at` | timestamp |

**Status semantics:**
- `sin-contacto` / `null` → actively missing (shown on map + desaparecidos panel)
- `localizado` → found via hospital list cross-reference
- `encontrado` → found via other means
- Found persons MUST be excluded from the missing count and map cluster

**DB counts (as of Jun 25, 2026):**
- All rows: ~53,700 | Deduped: ~44,600 | Sin-contacto: ~42,000 | Localizados: ~2,600

### `submitted_lists`
| Column | Notes |
|--------|-------|
| `id` | uuid PK |
| `submitter` | name/contact from form submitter (nullable) |
| `hospital` | hospital + date description (required) |
| `tweet_url` | link to original tweet/post (nullable) |
| `names` | raw pasted names, newline or comma separated (nullable) |
| `status` | `pending` → `processed` after running match_hospital_list.py |
| `submitted_at` | timestamp |

**BEFORE FIRST USE — run in Supabase Dashboard SQL Editor:**
```sql
CREATE TABLE IF NOT EXISTS submitted_lists (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  submitter    text,
  hospital     text NOT NULL,
  tweet_url    text,
  names        text,
  status       text DEFAULT 'pending',
  submitted_at timestamptz DEFAULT now()
);
```

**Workflow:** Form on /localizados (Listas tab → "+ Enviar lista") → inserts to `submitted_lists` with `status=pending` → Mario reviews in Supabase dashboard → runs `match_hospital_list.py` → mark `status=processed`.

### `building_damage`
| Column | Notes |
|--------|-------|
| `external_id` | ID from source platform |
| `external_source` | `terremotovenezuela.com` (primary), or tweet URL for manually added |
| `lat`, `lng` | required |
| `place` | building name |
| `damage_type` | `total` / `severo` / `parcial` |
| `needs` | SOS text, trapped person info, etc. |
| `photo_url` | nullable |
| `confirmations` | int |
| UNIQUE | `(external_source, external_id)` — use upsert, not insert |

---

## Key Files

### Frontend

**`apps/web/app/page.tsx`** — Main map page
- Mapbox layers: `building-damage-points` (orange), `reports-points` (violet), `missing-cluster` / `missing-unclustered` (violet, only sin-contacto)
- **CRITICAL:** Building click handler and reports click handler BOTH fire on point click. Fix: in `reports-points` click handler, check `m.queryRenderedFeatures(e.point, { layers: ["building-damage-points"] })` and return early if a building is at that point.
- `missingTotal` count: fetch `/api/missing-persons?count=1&status=sin-contacto` — NOT just `?count=1` (that counts all statuses including localizados)
- Missing persons map cluster: uses `/api/missing-persons/external` — must filter `.or("status.eq.sin-contacto,status.is.null")` to exclude found persons

**`apps/web/app/localizados/page.tsx`** — Localizados page
- **CRITICAL:** Use `/api/missing-persons` (relative URL), NOT `${NEXT_PUBLIC_API_URL}/missing-persons`. The FastAPI backend on Railway does NOT have missing-persons routes. Next.js API routes handle this.
- Tabs: "Confirmados" (matched tab) + "Todos" (all localizados)
- **Matched tab** only shows persons with `source_id` set (means they were in a missing-persons DB before cross-reference). Persons inserted fresh from a hospital list (no prior DB record) do NOT appear here.
- Expandable person cards: collapsed shows photo/name/age/location; expanded shows full photo, description, contact_info, and two source links (original missing-report platform + confirmation tweet)
- `confirmedMatched = matched.filter(p => p.source_id)` — this is the correct subset

**`apps/web/app/api/missing-persons/route.ts`**
- GET params: `q` (name search), `status` (sin-contacto/encontrado), `limit` (max 500), `offset`, `count=1` (count only), `matched=1` (only SismoVenezuela cross-references)
- `status=sin-contacto` → `.or("status.eq.sin-contacto,status.is.null")`
- `status=encontrado` → `.or("status.eq.encontrado,status.eq.localizado")`
- Always includes `.or("is_duplicate.eq.false,is_duplicate.is.null")`

**`apps/web/app/api/missing-persons/external/route.ts`**
- Drives the Mapbox violet cluster layer
- Must filter `status.eq.sin-contacto,status.is.null` — early versions did NOT do this, causing found persons to show as missing on the map

### Scrapers

**`scrapers/match_hospital_list.py`** — Hospital patient list cross-reference
```bash
conda run -n agent python scrapers/match_hospital_list.py \
  --names "Name1,Name2,Name3" \
  --hospital "Hospital X, City" \
  --tweet "https://x.com/..." \
  --source-label "Hospital X" \
  [--high-only] \
  [--dry-run]
```
- Fuzzy matching: `max(SequenceMatcher ratio, word-overlap ratio)`
- Thresholds: ≥0.85 high (auto-match), 0.72–0.85 medium (printed), <0.72 no match → insert new
- **`--high-only` flag**: demotes all medium-confidence matches to no-match → inserts them as new records. Use this when medium matches are last-name-only coincidences (different first names). This is the common case.
- On update: sets `status=localizado`, `external_source="SismoVenezuela via <label>"`, `source2_url=<tweet>`. **Does NOT overwrite `source_id`** — that field preserves the original platform link.
- On insert: creates new record with `status=localizado`, `external_source`, `source2_url`, `last_seen_location=hospital`

**`scrapers/missing_persons_scraper.py`** — Syncs from desaparecidosterremotovenezuela.com API
**`scrapers/venezulatebusca_scraper.py`** — Syncs from venezulatebusca.com
**`scrapers/building_damage_scraper.py`** — Syncs from terremotovenezuela.com public Supabase
**`scrapers/run_all.sh`** — Runs all scrapers; fired by launchd every 10 minutes

To run scrapers manually:
```bash
conda run -n agent python scrapers/missing_persons_scraper.py
conda run -n agent python scrapers/building_damage_scraper.py
conda run -n agent python scrapers/venezulatebusca_scraper.py
```

---

## Hospital List Workflow (how to process a new list)

When someone sends a photo/tweet with a hospital patient list:

1. **Extract names** — skip blanks, "Incompleto", "[en blanco]", numbering artifacts
2. **Deduplicate** — same name+ID appearing in multiple tweets = one entry; same ID with different spellings = keep one
3. **Dry-run first:**
   ```bash
   conda run -n agent python scrapers/match_hospital_list.py --names "..." --hospital "..." --tweet "..." --source-label "..." --high-only --dry-run
   ```
4. **Review medium-confidence matches** — if they're last-name-only with different first names, `--high-only` is correct
5. **Run for real** (remove `--dry-run`)

**Sources processed so far:**
| Hospital | Ward | Tweet | Names | Updated | Inserted |
|----------|------|-------|-------|---------|----------|
| Hospital Pérez Carreño | Pediatría 06/26 | @elhabito/2070174496913236064 | 15 | 5 | 10 |
| Hospital Pérez Carreño | Adult ward | @uiteraardpaard/2070143455385317665 | 86 | 46 | 40 |
| Multi-hospital consolidado (Pérez Carreño + Luciani + HUC + Baquero + Vargas) | 25 jun 2026 | @mariangelli (PDF) | 299 | 68 | 231 |

---

## Building List Workflow

When someone sends a list of collapsed buildings:

1. Cross-reference against our DB (terremotovenezuela.com syncs automatically)
2. Most buildings from La Guaira are already in DB — check for any NOT mentioned
3. Insert manually anything new:
   ```python
   sb.table('building_damage').insert({
       'external_id': 'unique-slug',
       'external_source': '<tweet_url>',
       'lat': ..., 'lng': ...,
       'place': 'Building name (neighborhood)',
       'damage_type': 'total',
       'needs': 'SOS text if applicable',
       'confirmations': 1,
       'reported_at': datetime.now(timezone.utc).isoformat(),
   }).execute()
   ```
4. Coordinates: use LOCATIONS dict from `apps/web/app/api/missing-persons/external/route.ts` for reference

**Added manually:** Edificio HOYO 5 (Av. Circunvalación, Caribe, La Guaira) — no rescuers, families trapped

---

## Known Bugs Fixed (don't reintroduce)

### 1. Wrong API URL for missing persons
**Bug:** `const API = process.env.NEXT_PUBLIC_API_URL ?? ""; fetch(${API}/api/missing-persons)` pointed to Railway FastAPI which has no such route.
**Fix:** Use relative URL `/api/missing-persons` — Next.js serves this from `apps/web/app/api/missing-persons/route.ts`

### 2. Building click opening wrong panel tab
**Bug:** Clicking an orange building dot opened the edificios panel briefly, then `fetchNearby` in the `reports-points` handler fired and switched to the reports tab.
**Fix:** In the `reports-points` click handler, add at the top:
```ts
if (m.queryRenderedFeatures(e.point, { layers: ["building-damage-points"] }).length > 0) return;
```
`e.stopPropagation()` does NOT work for Mapbox layer handlers — they fire independently.

### 3. Desaparecidos count including found persons
**Bug:** `missingTotal` fetched `?count=1` (all statuses). `localizados/encontrados` were counted as missing.
**Fix:** `?count=1&status=sin-contacto`

### 4. Map cluster showing found persons as missing
**Bug:** `/api/missing-persons/external` had no status filter — was plotting localizados on the map.
**Fix:** Add `.or("status.eq.sin-contacto,status.is.null")` to the Supabase query.

### 5. TypeScript errors on `selectedBuilding` fields typed as `unknown`
**Fix:** Use `!= null` check instead of truthy check for `unknown` typed values.

### 6. Edit tool failure
When using the Edit tool, always read the file first to get exact current content. The old_string must match character-for-character including whitespace.

---

## Data Sources

| Source | Platform | Type | Notes |
|--------|----------|------|-------|
| desaparecidos-vzla | desaparecidosterremotovenezuela.com | Missing persons | ~38,500 records. Deep link: `?persona=<source_id>` |
| venezulatebusca | venezulatebusca.com | Missing persons | ~6,000 records |
| SismoVenezuela via <hospital> | Our cross-reference | Localizados | From hospital patient lists |
| terremotovenezuela.com | terremotovenezuela.com | Buildings | ~325+ records, syncs automatically |
| YouTube/Twitter/Instagram | Various | Damage reports | Scraped via run_all.sh |

---

## Localizados Page — Tab Design

- **Tab "Confirmados":** People who were in the missing-persons DB AND then appeared on a hospital list. Filter: `source_id` is not null AND `external_source` contains "SismoVenezuela". These are the high-confidence matches.
- **Tab "Todos":** All localizados (status=localizado OR encontrado). Includes fresh inserts from hospital lists.
- **Tab "Listas"** *(to implement)*: Show the raw hospital lists as published, so families can browse the full list even if a person isn't in our missing DB.

---

## Deployment

- **Frontend:** Vercel (auto-deploys from `main` branch). URL: sismovenezuela.com
- **API:** Railway (FastAPI, handles report ingestion only — not missing persons)
- **Scrapers:** Mario's local machine, launchd cron every 10 min via `scrapers/run_all.sh`
- **DB:** Supabase (free tier, 500MB, PostGIS enabled)

To deploy frontend changes: `git push origin main` → Vercel auto-deploys.

---

## Running Locally

```bash
cd apps/web
npm install
npm run dev   # :3001

# TypeScript check
./node_modules/.bin/tsc --noEmit
```
