# Venezuela Earthquake Map 🇻🇪

Open-source real-time damage map aggregating reports from Twitter/X, Instagram, and YouTube. Built to help authorities and the public track affected zones following the June 24, 2026 magnitude 7.5 earthquake in Venezuela.

**Live map:** (deploy link TBD)

## What it does
- Scrapes social media every 15 minutes for earthquake damage reports
- Extracts locations from post text and maps them with coordinates
- Displays a heatmap + individual pins on an interactive map
- Each pin links to the original post and includes media

## Stack
- **Frontend:** Next.js + Mapbox GL JS
- **Backend:** FastAPI
- **Database:** Supabase + PostGIS
- **Scrapers:** Python (yt-dlp for YouTube, session auth for X/Twitter)
- **Geo-extraction:** Gemma 3 (local LLM fallback for location parsing)

## Setup

### 1. Database (Supabase)
1. Create a project at supabase.com
2. Run `infra/schema.sql` in the SQL editor

### 2. API
```bash
cd apps/api
cp .env.example .env        # fill in SUPABASE_URL + SUPABASE_SERVICE_KEY
pip install -r requirements.txt
uvicorn main:app --reload
```

### 3. Frontend
```bash
cd apps/web
cp .env.local.example .env.local   # fill in NEXT_PUBLIC_MAPBOX_TOKEN + NEXT_PUBLIC_API_URL
npm install
npm run dev
```

### 4. Scrapers
```bash
python scrapers/youtube.py     # searches YouTube for damage footage
python scrapers/twitter.py     # searches X/Twitter for reports
python scrapers/geo_extract.py # fills missing coordinates via Gemma
```

## Contributing
PRs welcome. If you have on-the-ground reports, open an issue or POST to `/ingest`.

## License
MIT
