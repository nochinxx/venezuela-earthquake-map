# SismoVenezuela — Agent Briefing

Real-time earthquake damage and missing persons map for the June 24, 2026 Venezuela earthquake (M7.1–7.5 near Yumare/La Guaira). Public at **sismovenezuela.com** (Vercel). Open source.

---

## Quick Operations Reference

```bash
# --- SCRAPERS ---
conda run -n agent python scrapers/missing_persons_scraper.py    # sync desaparecidos-vzla
conda run -n agent python scrapers/venezulatebusca_scraper.py    # sync venezulatebusca.com
conda run -n agent python scrapers/building_damage_scraper.py    # sync terremotovenezuela.com
conda run -n agent python scrapers/relief_centers.py             # sync centros de acopio

# --- HOSPITAL LIST CROSS-REFERENCE ---
conda run -n agent python scrapers/match_hospital_list.py \
  --names "Nombre1,Nombre2|CI123,Nombre3" \
  --hospital "Hospital X, Caracas" \
  --tweet "https://x.com/user/status/123" \
  --source-label "Hospital X" \
  --high-only --dry-run                  # remove --dry-run to write

# --- FRONTEND ---
cd apps/web && npm run dev               # :3001
./node_modules/.bin/tsc --noEmit        # type check

# --- DEPLOY ---
git push origin main                    # Vercel auto-deploys
```

---

## Parallel Terminal Setup

Open **4 terminals** for parallel processing:

| Terminal | Role | Command |
|----------|------|---------|
| **T1** | Scraper loop | `tail -f ~/agent/logs/earthquake-scraper.log` |
| **T2** | Hospital lists | run `match_hospital_list.py` per list |
| **T3** | Manual DB ops | Python REPL with Supabase client |
| **T4** | Frontend dev | `cd apps/web && npm run dev` |

**T3 quickstart (manual DB ops):**
```bash
cd scrapers && conda run -n agent python
```
```python
from dotenv import load_dotenv; import os; load_dotenv(".env")
from supabase import create_client
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
# now use sb.table(...) directly
```

---

## Architecture

```
apps/web/          Next.js 15 (App Router) + Mapbox GL JS + Tailwind — deployed to Vercel
apps/api/          FastAPI + uvicorn — NOT deployed (Railway free tier not available); runs locally only if needed
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
| `cedula` | Venezuelan ID number — used for exact matching; populated by venezulatebusca scraper |
| `status` | `sin-contacto` / `localizado` / `encontrado` |
| `external_source` | platform label e.g. `desaparecidos-vzla`, `venezulatebusca`, `SismoVenezuela via Hospital X` |
| `source_id` | **original platform ID** — NEVER overwrite on update. Deep-link key: `?persona=<source_id>` |
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

**Manual operations:**

```python
# Add a missing person manually
sb.table("missing_persons").insert({
    "name": "Nombre Apellido",
    "age": 35,
    "last_seen_location": "La Guaira, Vargas",
    "description": "Descripción opcional",
    "contact_info": "0414-1234567",
    "status": "sin-contacto",
    "external_source": "manual",
}).execute()

# Mark someone as encontrado manually
sb.table("missing_persons").update({
    "status": "encontrado",
    "external_source": "manual — confirmado por familiar",
}).eq("id", "<uuid>").execute()

# Mark as localizado (in hospital, source unknown)
sb.table("missing_persons").update({
    "status": "localizado",
    "external_source": "SismoVenezuela via Hospital X",
    "source2_url": "https://x.com/...",
}).eq("id", "<uuid>").execute()

# Search by name
rows = sb.table("missing_persons").select("id,name,status,cedula") \
    .ilike("name", "%Apellido%") \
    .or_("is_duplicate.eq.false,is_duplicate.is.null") \
    .limit(20).execute()
```

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

**CREATE TABLE (already applied):**
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

**Manual insert:**
```python
from datetime import datetime, timezone
sb.table("building_damage").insert({
    "external_id": "unique-slug",       # e.g. "edificio-hoyo-5-caribe"
    "external_source": "<tweet_url>",   # use tweet URL for manual entries
    "lat": 10.601,
    "lng": -66.934,
    "place": "Edificio X (Barrio, Ciudad)",
    "damage_type": "total",             # total / severo / parcial
    "needs": "SOS — personas atrapadas, sin rescatistas",
    "confirmations": 1,
    "reported_at": datetime.now(timezone.utc).isoformat(),
}).execute()
```

### `relief_centers` (centros de acopio)
| Column | Notes |
|--------|-------|
| `id` | uuid PK |
| `name` | center name |
| `address` | full address |
| `state` | Venezuelan state |
| `lat`, `lng` | coordinates |
| `source_name` | e.g. `@convzlacomando` |
| `source_url` | link to original post |
| `accepted_items` | comma-separated items accepted |

**Manual insert:**
```python
sb.table("relief_centers").insert({
    "name": "Centro de Acopio — Nombre",
    "address": "Dirección completa",
    "state": "Miranda",
    "lat": 10.4955,
    "lng": -66.8474,
    "source_name": "@cuenta",
    "source_url": "https://x.com/...",
    "accepted_items": "Agua, alimentos no perecederos, medicamentos",
}).execute()
```

**To run scraper (seeds + searches X for new centers):**
```bash
conda run -n agent python scrapers/relief_centers.py
```

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
- Tabs: "Cruces" (confirmed matches from our algorithm) + "Listas" (all hospital list rosters, accordion) + "Todos" (all localizados)
- **Cruces tab**: inline stats grid (sin-contacto / localizados / cruces / nuevas entradas) + per-list hit rate. Clicking a list name in stats navigates to the Listas tab and expands that accordion.
- **Listas tab**: accordion, each list collapsed by default. Uses `matched` array (loaded on mount) — does NOT need separate lazy load.
- **Matched tab** only shows persons with `source_id` set (means they were in a missing-persons DB before cross-reference). Persons inserted fresh from a hospital list (no prior DB record) do NOT appear here.
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
  --names "Name1,Name2|CI456789,Name3" \
  --hospital "Hospital X, Caracas" \
  --tweet "https://x.com/..." \
  --source-label "Hospital X" \
  [--high-only] \
  [--dry-run]
```
- Name format: `"Apellido Nombre|cédula"` — the `|cédula` part is optional
- Matching priority: 1) exact cédula → 🟢 `SismoVenezuela:cedula via X`, 2) fuzzy name ≥85% → 🟡 `SismoVenezuela:high via X`, 3) fuzzy name 72–84% → 🟠 `SismoVenezuela:medium via X`, 4) no match → ⚫️ insert new
- **`--high-only` flag**: demotes all medium-confidence matches to no-match → inserts them as new records. Use this when medium matches are last-name-only coincidences (different first names). **This is the common case — use it by default.**
- On update: sets `status=localizado`, `external_source`, `source2_url`. **Does NOT overwrite `source_id`** — that field preserves the original platform link.
- On insert: creates new record with `status=localizado`, `external_source`, `source2_url`, `last_seen_location=hospital`

**`scrapers/missing_persons_scraper.py`** — Syncs from desaparecidosterremotovenezuela.com API
**`scrapers/venezulatebusca_scraper.py`** — Syncs from venezulatebusca.com (also populates `cedula` field)
**`scrapers/building_damage_scraper.py`** — Syncs from terremotovenezuela.com public Supabase
**`scrapers/relief_centers.py`** — Seeds + scrapes centros de acopio from X
**`scrapers/run_all.sh`** — Runs all scrapers; fired by launchd every 10 minutes (building damage + missing persons every 30 min)

---

## Hospital List Workflow (how to process a new list)

When someone sends a photo/tweet with a hospital patient list:

1. **Extract names** — skip blanks, "Incompleto", "[en blanco]", numbering artifacts
2. **Deduplicate** — same name+ID appearing in multiple tweets = one entry; same ID with different spellings = keep one
3. **Dry-run first:**
   ```bash
   conda run -n agent python scrapers/match_hospital_list.py \
     --names "Nombre1|CI1234,Nombre2,Nombre3|CI5678" \
     --hospital "Hospital X, Caracas" \
     --tweet "https://x.com/..." \
     --source-label "Hospital X" \
     --high-only --dry-run
   ```
4. **Review medium-confidence matches** — if they're last-name-only with different first names, `--high-only` is correct
5. **Run for real** (remove `--dry-run`)
6. **For large lists (>100 names)** — write a Python script importing `run()` directly to avoid CLI length limits:
   ```python
   # /tmp/run_match.py
   import sys; sys.path.insert(0, "scrapers")
   from match_hospital_list import run
   names = ["Nombre Apellido|CI", "Nombre2", ...]  # full list
   run(names, hospital="Hospital X, Ciudad", tweet_url="https://x.com/...",
       source_label="Hospital X", dry_run=False, high_only=True)
   ```
   ```bash
   conda run -n agent python /tmp/run_match.py
   ```

**Sources processed so far:**
| Hospital | Ward | Tweet | Names | Updated | Inserted |
|----------|------|-------|-------|---------|----------|
| Hospital Pérez Carreño | Pediatría 06/26 | @elhabito/2070174496913236064 | 15 | 5 | 10 |
| Hospital Pérez Carreño | Adult ward | @uiteraardpaard/2070143455385317665 | 86 | 46 | 40 |
| Multi-hospital consolidado (Pérez Carreño + Luciani + HUC + Baquero + Vargas) | 25 jun 2026 | @mariangelli (PDF) | 299 | 68 | 231 |

---

## Building List Workflow

When someone sends a list of collapsed buildings:

1. Cross-reference against our DB (terremotovenezuela.com syncs automatically every 30 min)
2. Most buildings from La Guaira are already in DB — check for any NOT mentioned
3. Insert manually anything new using the snippet in the `building_damage` section above
4. Coordinates: use LOCATIONS dict from `apps/web/app/api/missing-persons/external/route.ts` for reference

**Added manually:** Edificio HOYO 5 (Av. Circunvalación, Caribe, La Guaira) — no rescuers, families trapped

---

## Relief Centers Workflow

When someone shares a new centro de acopio:

1. Check if it already exists:
   ```python
   sb.table("relief_centers").select("*").ilike("address", "%dirección%").execute()
   ```
2. Insert manually using the snippet in the `relief_centers` section above
3. The scraper (`relief_centers.py`) auto-discovers new centers from X every 30 min — manual insert is only needed for Instagram/WhatsApp sources

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

### 7. sourceTitle() not stripping confidence prefix
**Bug:** Function checked `src.includes("SismoVenezuela via ")` which failed for `"SismoVenezuela:high via X"`.
**Fix:** Use regex: `src.replace(/^SismoVenezuela(?::[a-z]+)? via /i, "")`

### 8. Listas tab "Ver más" / pagination
**Bug:** Listas tab used `all` (paginated, lazy-loaded) — showed only 1–2 lists until user clicked "Ver más".
**Fix:** `groupedByList` now reads from `matched` (loaded on mount), which contains all SismoVenezuela records including new inserts.

---

## Data Sources

| Source | Platform | Type | Notes |
|--------|----------|------|-------|
| desaparecidos-vzla | desaparecidosterremotovenezuela.com | Missing persons | ~38,500 records. Deep link: `?persona=<source_id>`. No cédulas exposed. |
| venezulatebusca | venezulatebusca.com | Missing persons | ~6,000 records. Populates `cedula` field — enables 🟢 exact matches |
| SismoVenezuela via <hospital> | Our cross-reference | Localizados | From hospital patient lists |
| terremotovenezuela.com | terremotovenezuela.com | Buildings | ~325+ records, syncs automatically |
| YouTube/Twitter/Instagram | Various | Damage reports | Scraped via run_all.sh |

---

## Localizados Page — Tab Design

- **Tab "Cruces":** People who were in the missing-persons DB AND then appeared on a hospital list. Filter: `source_id` is not null AND `external_source` contains "SismoVenezuela". Shows inline stats + per-list hit rate. Clicking a list name navigates to Listas tab.
- **Tab "Listas":** All hospital list rosters as published (accordion, collapsed by default). Includes everyone — matched and new inserts. Data comes from `matched` array (no separate load needed).
- **Tab "Todos":** All localizados (status=localizado OR encontrado). Includes fresh inserts from hospital lists. Paginated.

**Confidence circles:**
- 🟢 `SismoVenezuela:cedula via X` — exact cédula match
- 🟡 `SismoVenezuela:high via X` — name similarity ≥85%
- 🟠 `SismoVenezuela:medium via X` — name similarity 72–84%
- ⚫️ `SismoVenezuela via X` — new insert, no prior DB record

---

## Deployment

- **Frontend:** Vercel (auto-deploys from `main` branch). URL: sismovenezuela.com
- **API:** FastAPI — NOT deployed to Railway (free tier not available). Not in use for production.
- **Scrapers:** Mario's local machine, launchd cron every 10 min via `scrapers/run_all.sh` (job: `com.marios-agent.earthquake-scraper`)
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
