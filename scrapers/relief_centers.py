#!/usr/bin/env python3
"""
relief_centers.py — Find and store relief center (centro de acopio) locations.

Sources:
  - Hardcoded verified posts (run once to seed)
  - Twitter/X Playwright search for new announcements every cycle

Run: conda run -n agent python scrapers/relief_centers.py
"""
import os, sys, re, time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

from supabase import create_client
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from transcribe_youtube import gemma_location, keyword_location, GENERIC

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
PROFILE_DIR = Path.home() / "agent" / "browser-profile"

# Known coordinates for Venezuelan cities/neighborhoods
COORDS = {
    "altamira":        (10.4955, -66.8474),  # eastern Caracas, Miranda
    "miranda":         (10.4955, -66.8474),
    "maracay":         (10.2469, -67.5958),  # Aragua capital
    "aragua":          (10.2603, -67.5894),
    "el viñedo":       (10.1820, -67.9800),  # Valencia neighborhood
    "valencia":        (10.1620, -67.9903),
    "carabobo":        (10.1620, -67.9903),
    "caracas":         (10.4806, -66.9036),
    "barquisimeto":    (10.0647, -69.3571),
    "maracaibo":       (10.6316, -71.6428),
    "san felipe":      (10.3394, -68.7453),
    "la guaira":       (10.6013, -66.9337),
    "cumana":          (10.4574, -64.1744),
    "merida":          (8.5916,  -71.1440),
    "san cristobal":   (7.7653,  -72.2254),
}

# Seed data from verified Comando Venezuela post
SEED_CENTERS = [
    {
        "name": "Comando Venezuela — Miranda",
        "address": "Cuarta avenida de Altamira, entre novena y décima transversal; quinta El Bejucal",
        "state": "Miranda",
        "lat": 10.4955,
        "lng": -66.8474,
        "source_name": "@convzlacomando",
        "source_url": "https://www.instagram.com/p/DZ_kBlyIVRI/",
        "accepted_items": "Agua, alimentos no perecederos, insumos médicos, ropa y abrigos",
    },
    {
        "name": "Comando Venezuela — Aragua",
        "address": "Avenida 19 de abril, Centro Comercial La Capilla, Piso 1, local 21",
        "state": "Aragua",
        "lat": 10.2469,
        "lng": -67.5958,
        "source_name": "@convzlacomando",
        "source_url": "https://www.instagram.com/p/DZ_kBlyIVRI/",
        "accepted_items": "Agua, alimentos no perecederos, insumos médicos, ropa y abrigos",
    },
    {
        "name": "Comando Venezuela — Carabobo",
        "address": "Avenida Monseñor Adams, El Viñedo, Edificio Talislandia, mezzanina",
        "state": "Carabobo",
        "lat": 10.1820,
        "lng": -67.9800,
        "source_name": "@convzlacomando",
        "source_url": "https://www.instagram.com/p/DZ_kBlyIVRI/",
        "accepted_items": "Agua, alimentos no perecederos, insumos médicos, ropa y abrigos",
    },
]

SEARCH_QUERIES = [
    "centro de acopio Venezuela terremoto 2026",
    "punto de acopio sismo Venezuela junio 2026",
    "colecta ayuda terremoto Venezuela 2026 dirección",
    "refugio evacuados terremoto Venezuela 2026",
]

CENTER_SIGNALS = [
    "centro de acopio", "punto de acopio", "recolección", "colecta",
    "donaciones", "refugio", "albergue", "evacuados",
    "avenida", "edificio", "local", "piso", "calle", "carrera",
]

EXTRACT_JS = """() => {
    const articles = [...document.querySelectorAll("article[data-testid='tweet']")];
    return articles.map(a => {
        const t = a.querySelector("[data-testid='tweetText']");
        const time = a.querySelector("time");
        const author = a.querySelector("[data-testid='User-Name'] a");
        const link = a.querySelector("a[href*='/status/']");
        const href = link ? link.href : "";
        const m = href.match(/status\\/([0-9]+)/);
        return {
            text: t ? t.innerText.trim() : "",
            date: time ? time.getAttribute("datetime") : "",
            author: author ? author.innerText.replace("@","").trim() : "",
            tweet_id: m ? m[1] : "",
            url: href,
        };
    }).filter(t => t.text.length > 20 && t.tweet_id);
}"""


def resolve_coords(text: str, state: str = "") -> tuple:
    """Keyword match then Gemma to find city from address/tweet text."""
    combined = f"{text} {state}".lower()
    for place, coords in COORDS.items():
        if place in combined:
            return coords
    # Gemma fallback
    loc, lat, lng = gemma_location(text)
    if loc and loc.lower() not in GENERIC and lat:
        return lat, lng
    return None, None


def is_relief_post(text: str) -> bool:
    t = text.lower()
    return any(s in t for s in CENTER_SIGNALS)


def seed():
    print("[relief_centers] Seeding Comando Venezuela locations...")
    for center in SEED_CENTERS:
        # Check if address already exists to avoid duplicates
        existing = sb.table("relief_centers").select("id").eq("address", center["address"]).execute().data
        if existing:
            print(f"  (skip) {center['name']} already in DB")
            continue
        try:
            sb.table("relief_centers").insert(center).execute()
            print(f"  ✓ {center['name']}")
        except Exception as e:
            print(f"  [error] {center['name']}: {e}")


def scrape_x():
    print("[relief_centers] Searching X for new relief center announcements...")
    found = 0
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE_DIR), headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        page = ctx.new_page()
        page.set_extra_http_headers({"Accept-Language": "es,en;q=0.9"})

        import urllib.parse
        for query in SEARCH_QUERIES:
            url = f"https://x.com/search?q={urllib.parse.quote(query)}&f=live"
            page.goto(url, timeout=30000)
            try:
                page.wait_for_selector("article[data-testid='tweet']", timeout=10000)
            except Exception:
                pass
            time.sleep(2)
            tweets = page.evaluate(EXTRACT_JS)
            print(f"  '{query[:50]}' → {len(tweets)} tweets")

            for t in tweets:
                text = t.get("text", "")
                if not is_relief_post(text):
                    continue
                lat, lng = resolve_coords(text)
                if not lat:
                    continue
                # Extract state from Gemma location
                loc, g_lat, g_lng = gemma_location(text)
                payload = {
                    "name": f"Centro de Acopio — @{t.get('author', 'X')}",
                    "address": text[:300],
                    "state": loc or "",
                    "lat": lat, "lng": lng,
                    "source_name": f"@{t.get('author', '')}",
                    "source_url": t.get("url", ""),
                    "accepted_items": "",
                }
                try:
                    existing = sb.table("relief_centers").select("id").eq("address", text[:300]).execute().data
                    if existing:
                        continue
                    sb.table("relief_centers").insert(
                        {k: v for k, v in payload.items() if v is not None}
                    ).execute()
                    found += 1
                    print(f"    → {payload['name']} in {loc}")
                except Exception as e:
                    print(f"    [push error] {e}")

        ctx.close()
    print(f"[relief_centers] {found} new centers found via X")


def main():
    seed()
    scrape_x()


if __name__ == "__main__":
    main()
