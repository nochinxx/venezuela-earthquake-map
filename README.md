# 🇻🇪 Venezuela Earthquake Map

Real-time damage map for the **M7.2 earthquake** near Yumare, Venezuela — June 24, 2026.

**Live:** [venezuela-earthquake-map.vercel.app](https://venezuela-earthquake-map.vercel.app)

---

## What it does

Aggregates damage reports from YouTube, X/Twitter, and Instagram every 10 minutes and plots them on an interactive heatmap. Built hours after the earthquake to give rescue teams, journalists, and families a real-time picture of where damage is concentrated.

- 🌡️ **Damage heatmap** — weighted by report credibility and damage severity
- 📍 **Click any zone** — see the underlying reports (videos, tweets, posts)
- 📦 **Relief centers** — verified centros de acopio with addresses and accepted items
- 🧍 **Missing persons** — submit and view missing person reports on the map
- 📞 **Emergency directory** — 30+ Caracas hospitals, ambulances, bomberos, rescue teams
- ⚠️ **USGS PAGER** — live fatality projection (red alert: 10K–100K estimated)

## Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 15 App Router + Mapbox GL JS + Tailwind |
| Database | Supabase + PostGIS |
| Scrapers | Python + Playwright + yt-dlp + Whisper (base) |
| Geo-extraction | Gemma 3 4b via ollama (local, no API cost) |
| Deploy | Vercel (frontend) + launchd on Mac Mini (scrapers) |

## Data pipeline

- **YouTube** — 6 search queries, auto-subtitles + Whisper fallback, every 10 min
- **X/Twitter** — 13 Playwright searches + 3 verified accounts (convzlacomando, MariaCorinaYA, CarlaAngola), every 10 min
- **Instagram** — 5 hashtags via saved session, every 10 min
- **Comments** — YouTube Data API v3 + X/IG reply scrapers, every 30 min
- **Relief centers** — seeded from verified posts + X search, every 30 min
- **Casualties** — scraped from FUNVISIS, Cruz Roja, CNN, AP timelines, every 30 min

## Local setup

```bash
# Frontend
cd apps/web
cp .env.local.example .env.local   # add NEXT_PUBLIC_MAPBOX_TOKEN
npm install && npm run dev

# Scrapers (requires conda + ollama)
conda create -n agent python=3.11 && conda activate agent
pip install -r scrapers/requirements.txt
cp scrapers/.env.example scrapers/.env   # add SUPABASE_URL + SUPABASE_SERVICE_KEY
ollama pull gemma3:4b
conda run -n agent python scrapers/youtube.py
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — geolocating reports, new scrapers, Gemma prompt improvements, and data quality all welcome.

## Support

Running the scrapers costs money (X API for sustainable access, Vercel bandwidth). If this helped you or your organization, consider supporting:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support_this_project-FF5E5B?logo=ko-fi&logoColor=white&style=flat-square)](https://ko-fi.com/venezuelaearthquakemap)

## License

MIT — use it, fork it, adapt it for any disaster response.
