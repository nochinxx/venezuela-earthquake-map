#!/usr/bin/env python3
"""
twitter_search.py — Search X for earthquake tweets using the saved Playwright session.

Uses the same persistent browser profile as ~/agent/bin/twitter-fetch.py
(already logged into X — no API key needed).

Run: conda run -n agent python scrapers/twitter_search.py
"""
import os, json, time, sys
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

from supabase import create_client
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from guardrails import is_credible, cap_damage

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

PROFILE_DIR = Path.home() / "agent" / "browser-profile"

SEARCHES = [
    "#TemblorVenezuela",
    "#SismoVenezuela",
    "#Terremoto Venezuela",
    "#24Jun sismo Venezuela",
    "La Guaira terremoto 2026",
    "San Bernardino sismo daños 2026",
    "terremoto Venezuela daños junio 2026",
    "sismo Venezuela edificio derrumbe 2026",
    "Venezuela earthquake 2026 damage",
    "Yumare OR Carabobo terremoto 2026",
    "from:convzlacomando terremoto OR sismo",
    "from:MariaCorinaYA terremoto OR sismo",
    "from:CarlaAngola terremoto OR sismo",
]

LOCATIONS = {
    "caracas": (10.4806, -66.9036), "valencia": (10.1620, -67.9903),
    "carabobo": (10.1620, -67.9903), "maracaibo": (10.6316, -71.6428),
    "barquisimeto": (10.0647, -69.3571), "maracay": (10.2469, -67.5958),
    "yumare": (10.6383, -68.6847), "san felipe": (10.3394, -68.7453),
    "yaracuy": (10.3394, -68.7453), "merida": (8.5916, -71.1440),
    "maturin": (9.7450, -63.1800), "petare": (10.4800, -66.8000),
    "miranda": (10.3000, -66.6000), "vargas": (10.6000, -67.1000),
    "cumana": (10.4574, -64.1744), "falcon": (11.2, -69.7),
    "lara": (10.0647, -69.3571), "aragua": (10.2603, -67.5894),
    "la guaira": (10.6013, -66.9337), "guarenas": (10.4667, -66.5333),
}

EXTRACT_JS = """() => {
    const articles = [...document.querySelectorAll("article[data-testid='tweet']")];
    return articles.map(article => {
        const textEl = article.querySelector("[data-testid='tweetText']");
        const timeEl = article.querySelector("time");
        const authorEl = article.querySelector("[data-testid='User-Name'] span");
        const imgs = [...article.querySelectorAll("img[src*='pbs.twimg.com/media']")]
            .map(i => i.src);
        const linkEl = article.querySelector("a[href*='/status/']");
        const href = linkEl ? linkEl.href : "";
        const match = href.match(/status\\/([0-9]+)/);
        return {
            text: textEl ? textEl.innerText.trim() : "",
            date: timeEl ? timeEl.getAttribute("datetime") : "",
            author: authorEl ? authorEl.innerText.replace("@","").trim() : "",
            media_urls: imgs,
            tweet_id: match ? match[1] : "",
            url: href,
        };
    }).filter(t => t.text.length > 5 && t.tweet_id);
}"""

CUTOFF = "2026-06-24"


def extract_location(text):
    t = text.lower()
    for place, (lat, lng) in LOCATIONS.items():
        if place in t:
            return place.title(), lat, lng
    return None, None, None


def estimate_damage(text):
    t = text.lower()
    if any(w in t for w in ["colaps", "derrumb", "destrui", "cayó", "caído"]):
        return 5
    if any(w in t for w in ["grave", "severo"]):
        return 4
    if any(w in t for w in ["daño", "grieta", "afectad"]):
        return 3
    return 2


def push(tweet: dict) -> bool:
    if not tweet.get("tweet_id"):
        return False
    date_str = tweet.get("date", "")
    if date_str and date_str[:10] < CUTOFF:
        return False  # too old
    text = tweet.get("text", "")
    author = tweet.get("author", "")
    ok, reason = is_credible(text, author)
    if not ok:
        print(f"  [guardrail] {reason}: {text[:60]}")
        return False
    loc, lat, lng = extract_location(text)
    payload = {
        "source": "twitter",
        "source_url": tweet.get("url") or f"https://x.com/i/web/status/{tweet['tweet_id']}",
        "source_id": tweet["tweet_id"],
        "author": tweet.get("author"),
        "text_content": text,
        "media_urls": tweet.get("media_urls", []),
        "lat": lat, "lng": lng,
        "location_name": loc,
        "damage_level": cap_damage(estimate_damage(text), "twitter", author),
        "post_time": date_str or None,
    }
    try:
        sb.table("reports").upsert(
            {k: v for k, v in payload.items() if v is not None},
            on_conflict="source_url"
        ).execute()
        return True
    except Exception as e:
        print(f"  [push error] {e}")
        return False


def search_x(page, query: str) -> list[dict]:
    import urllib.parse
    encoded = urllib.parse.quote(query)
    url = f"https://x.com/search?q={encoded}&f=live"
    page.goto(url, timeout=30000)
    # X never reaches networkidle — wait for first tweet or timeout
    try:
        page.wait_for_selector("article[data-testid='tweet']", timeout=12000)
    except Exception:
        pass
    time.sleep(2)
    # Scroll to load more tweets
    for _ in range(3):
        page.keyboard.press("End")
        time.sleep(1.5)
    return page.evaluate(EXTRACT_JS)


def main():
    print(f"[twitter_search] {len(SEARCHES)} queries via Playwright session")
    total = 0
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        page = context.new_page()
        page.set_extra_http_headers({"Accept-Language": "es,en;q=0.9"})

        for query in SEARCHES:
            print(f"  Searching: {query}")
            try:
                tweets = search_x(page, query)
                print(f"    {len(tweets)} tweets found")
                for t in tweets:
                    if push(t):
                        total += 1
            except Exception as e:
                print(f"  [error] {e}")

        context.close()
    print(f"[twitter_search] Done — {total} pushed")


if __name__ == "__main__":
    main()
