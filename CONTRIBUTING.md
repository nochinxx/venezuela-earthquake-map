# Contributing to Venezuela Earthquake Map

This map aggregates real-time damage reports from YouTube, X/Twitter, and Instagram following the M7.2 earthquake near Yumare, Venezuela on June 24, 2026.

## How to help

### 🗺️ Geolocate reports
Many Instagram posts have no coordinates. If you know Venezuela geography, open an issue with:
- Report ID (from the URL or Supabase)
- Correct city/neighborhood
- Approximate lat/lng

### 🔍 Add new scrapers
Missing a source? (TikTok, Telegram, local Venezuelan news sites)
1. Fork the repo
2. Add a scraper in `scrapers/` following the pattern in `twitter_search.py`
3. Use `guardrails.py` for fake-news filtering
4. Open a PR

### 🌐 Improve location extraction
`scrapers/transcribe_youtube.py` uses Gemma 3 4b via ollama for geo-extraction.
Better prompts or a different model would meaningfully improve coverage.

### 🏥 Add verified data sources
Open an issue if you know of:
- Verified casualty figures from official bodies
- New relief centers (centros de acopio)
- Emergency contact updates

### 🐛 Bug reports
Open a GitHub issue with:
- What you saw
- What you expected
- Browser and device

## Stack
- **Frontend**: Next.js 15 App Router + Mapbox GL JS + Tailwind
- **Database**: Supabase + PostGIS
- **Scrapers**: Python + Playwright + yt-dlp + Whisper + Gemma
- **Geo-extraction**: Gemma 3 4b (ollama, local)
- **Deploy**: Vercel (frontend) + launchd (scrapers on Mac Mini)

## Local setup

```bash
# Frontend
cd apps/web
cp .env.example .env.local   # add NEXT_PUBLIC_MAPBOX_TOKEN
npm install && npm run dev

# Scrapers (Mac/Linux, conda required)
conda create -n agent python=3.11
conda activate agent
pip install -r scrapers/requirements.txt
cp scrapers/.env.example scrapers/.env   # add SUPABASE keys
```

## License
MIT — use it, fork it, adapt it for any disaster response.
