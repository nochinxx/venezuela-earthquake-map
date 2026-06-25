#!/usr/bin/env python3
"""
twitter.py — Scrape earthquake tweets and push to the API.

Uses the existing twitter-fetch.py session cookie approach.
Run: conda run -n agent python scrapers/twitter.py
"""
import os, sys, json, subprocess, httpx
from datetime import datetime, timezone
from pathlib import Path

API_URL = os.environ.get("API_URL", "http://localhost:8000")
TWITTER_FETCH = Path.home() / "agent" / "bin" / "twitter-fetch.py"

SEARCH_QUERIES = [
    "#TemblorVenezuela",
    "#SismoVenezuela",
    "#TemblorEnVenezuela",
    "terremoto Venezuela daños",
    "sismo Venezuela edificio",
    "temblor Venezuela zona",
    "Venezuela earthquake damage",
]

VENEZUELA_LOCATIONS = {
    "caracas": (10.4806, -66.9036),
    "valencia": (10.1620, -67.9903),
    "maracaibo": (10.6316, -71.6428),
    "barquisimeto": (10.0647, -69.3571),
    "carabobo": (10.1620, -67.9903),
    "aragua": (10.2603, -67.5894),
    "miranda": (10.3000, -66.6000),
    "vargas": (10.6000, -67.1000),
    "maturin": (9.7450, -63.1800),
    "barcelona": (10.1333, -64.6833),
    "cumana": (10.4574, -64.1744),
    "merida": (8.5916, -71.1440),
    "san cristobal": (7.7653, -72.2254),
    "maracay": (10.2469, -67.5958),
    "ciudad bolivar": (8.1222, -63.5497),
    "puerto la cruz": (10.2131, -64.6347),
    "el tigre": (8.8884, -64.2496),
    "petare": (10.4800, -66.8000),
    "guarenas": (10.4667, -66.5333),
    "guatire": (10.4750, -66.5333),
}


def extract_location(text: str) -> tuple[str | None, float | None, float | None]:
    text_lower = text.lower()
    for place, (lat, lng) in VENEZUELA_LOCATIONS.items():
        if place in text_lower:
            return place.title(), lat, lng
    return None, None, None


def estimate_damage(text: str) -> int:
    text_lower = text.lower()
    if any(w in text_lower for w in ["colaps", "derrumb", "destrui", "destruy", "collapse", "fell", "caído", "cayó"]):
        return 5
    if any(w in text_lower for w in ["severo", "grave", "serious", "major damage", "daños graves"]):
        return 4
    if any(w in text_lower for w in ["daño", "damage", "grieta", "crack", "afectad"]):
        return 3
    if any(w in text_lower for w in ["temblor", "sismo", "sacudió", "shook", "felt"]):
        return 2
    return 1


def fetch_tweets(query: str) -> list[dict]:
    try:
        result = subprocess.run(
            ["conda", "run", "-n", "agent", "python", str(TWITTER_FETCH), "--search", query, "--limit", "20"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            print(f"  [warn] fetch failed for: {query}")
            return []
        return json.loads(result.stdout)
    except Exception as e:
        print(f"  [error] {e}")
        return []


def push_report(tweet: dict) -> bool:
    text = tweet.get("text", "")
    location_name, lat, lng = extract_location(text)
    damage_level = estimate_damage(text)
    post_time = tweet.get("created_at") or datetime.now(timezone.utc).isoformat()

    payload = {
        "source": "twitter",
        "source_url": tweet.get("url") or f"https://x.com/i/web/status/{tweet.get('id')}",
        "source_id": tweet.get("id"),
        "author": tweet.get("author_username") or tweet.get("author"),
        "text_content": text,
        "media_urls": tweet.get("media_urls", []),
        "lat": lat,
        "lng": lng,
        "location_name": location_name,
        "damage_level": damage_level,
        "post_time": post_time,
    }

    try:
        r = httpx.post(f"{API_URL}/ingest", json=payload, timeout=10)
        return r.status_code == 201
    except Exception as e:
        print(f"  [push error] {e}")
        return False


def main():
    print(f"[twitter scraper] Starting — {len(SEARCH_QUERIES)} queries")
    total_pushed = 0

    for query in SEARCH_QUERIES:
        print(f"  Searching: {query}")
        tweets = fetch_tweets(query)
        print(f"    Got {len(tweets)} tweets")
        for tweet in tweets:
            if push_report(tweet):
                total_pushed += 1

    print(f"[twitter scraper] Done — {total_pushed} reports pushed")


if __name__ == "__main__":
    main()
