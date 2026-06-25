# Venezuela Earthquake Map — Session Briefing

Open-source real-time damage heatmap for the June 24, 2026 Venezuela earthquake (M7.1–7.5). Aggregates reports from YouTube, Twitter/X, and Instagram. Built to ship fast for public + authority use.

---

## What's already built (don't rebuild)

| Component | Path | Status |
|-----------|------|--------|
| FastAPI backend | `apps/api/main.py` | Done — `/ingest`, `/reports/geojson`, `/reports/stats` |
| Next.js + Mapbox frontend | `apps/web/app/page.tsx` | Done — dark heatmap, damage legend, click panel |
| Supabase schema | `infra/schema.sql` | Done — already applied to prod DB |
| YouTube scraper | `scrapers/youtube.py` | Done — 39 reports already in DB |
| Twitter scraper | `scrapers/twitter.py` | Scaffolded — needs session auth to run |
| Gemma geo-extractor | `scrapers/geo_extract.py` | Scaffolded — needs Gemma/ollama locally |

---

## Stack

- **Frontend:** Next.js (app router) + Mapbox GL JS + Tailwind
- **Backend:** FastAPI + uvicorn
- **DB:** Supabase + PostGIS (project: `pjvzoacewosymllnejcr`)
- **Scrapers:** Python, yt-dlp for YouTube, twitter-fetch session for X
- **Geo-extraction:** Gemma 3 4b via ollama (local LLM, no API cost)

---

## Env files (gitignored — create these manually)

### `apps/api/.env`
```
SUPABASE_URL=https://pjvzoacewosymllnejcr.supabase.co
SUPABASE_SERVICE_KEY=<service role key — get from Mario or Supabase dashboard>
```

### `apps/web/.env.local`
```
NEXT_PUBLIC_MAPBOX_TOKEN=<Mapbox public token — get from Mario>
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Current state of the DB

- 39 YouTube reports in `reports` table
- Most geolocated to Caracas (keyword match) — Gemma extractor will refine
- 0 Twitter/Instagram reports yet

---

## What to build next (priority order)

### 1. Deploy frontend to Vercel (highest priority — gets the map public)
- `cd apps/web && vercel --prod`
- Set env vars in Vercel dashboard: `NEXT_PUBLIC_MAPBOX_TOKEN` + `NEXT_PUBLIC_API_URL` (point to Railway URL once API is deployed)
- The frontend is static-ish — Vercel free tier is fine

### 2. Deploy API to Railway
- Go to railway.app → New Project → Deploy from GitHub → select `venezuela-earthquake-map` → set root to `apps/api`
- Set env vars: `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Once deployed, update `NEXT_PUBLIC_API_URL` in Vercel to the Railway URL

### 3. Wire CORS for production
Once the Vercel URL is known, update `allow_origins` in `apps/api/main.py`:
```python
allow_origins=["https://your-vercel-url.vercel.app", "http://localhost:3001"],
```

### 4. Run scrapers from this machine
```bash
# YouTube (works out of the box if yt-dlp is installed)
API_URL=https://your-railway-url.railway.app python scrapers/youtube.py

# Twitter — needs a logged-in X session cookie
# See scrapers/twitter.py — it calls twitter-login.py from the agent machine
# Simplest alternative: use the X API v2 free tier (500k tweets/month)
# or manually paste tweet JSON into /ingest
```

### 5. Add Instagram scraper
Instagram requires auth. Options:
- Apify Instagram Scraper (paid, ~$0.50/1000 posts) — fastest
- instaloader Python lib with a burner account login
- Manual: paste report URLs into a simple admin form that calls `/ingest`

### 6. Add manual report submission form
Simple form on the map page: URL + location + description → POST `/ingest`
Lets anyone contribute a report directly.

---

## Running locally

```bash
# API
cd apps/api
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend
cd apps/web
npm install
npm run dev   # runs on :3001 if :3000 is taken
```

---

## API reference

```
GET  /health                    → {"status": "ok"}
GET  /reports/geojson           → GeoJSON FeatureCollection (all reports)
GET  /reports/geojson?source=youtube&min_damage=3
GET  /reports/stats             → {"total": N, "by_source": {...}}
POST /ingest                    → add a report (body: ReportIn schema)
```

### ReportIn schema
```json
{
  "source": "twitter | instagram | youtube",
  "source_url": "https://...",
  "source_id": "optional",
  "author": "optional",
  "text_content": "optional",
  "media_urls": [],
  "lat": 10.48,
  "lng": -66.90,
  "location_name": "Caracas",
  "damage_level": 3,
  "post_time": "2026-06-24T12:00:00Z"
}
```

---

## Venezuela location reference (for scraper geo-matching)

Key cities and approximate coordinates already in `scrapers/twitter.py` and `scrapers/youtube.py`. Add more as needed:

| City | Lat | Lng |
|------|-----|-----|
| Caracas | 10.4806 | -66.9036 |
| Valencia / Carabobo | 10.1620 | -67.9903 |
| Maracaibo | 10.6316 | -71.6428 |
| Barquisimeto | 10.0647 | -69.3571 |
| Maracay | 10.2469 | -67.5958 |
| Mérida | 8.5916 | -71.1440 |
| Cumaná | 10.4574 | -64.1744 |

---

## Damage level guide

| Level | Label | Signals in text |
|-------|-------|-----------------|
| 1 | Menor | "sentí", "shook", "felt" |
| 2 | Leve | "temblor", "sismo" |
| 3 | Moderado | "daño", "grieta", "afectado" |
| 4 | Severo | "grave", "severo", "serious damage" |
| 5 | Colapso | "colaps", "derrumb", "cayó", "fell" |
