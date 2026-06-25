#!/usr/bin/env python3
"""
twitter.py — Scrape earthquake tweets via X API v2 and push to Supabase.

Requires: X developer account (free tier) → bearer token
Get one at: developer.twitter.com → Projects → App → Keys and Tokens → Bearer Token

Set env: export X_BEARER_TOKEN=AAAA...
Or add to scrapers/.env

Run: python scrapers/twitter.py
"""
import os, httpx, json
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

from supabase import create_client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
X_BEARER = os.environ.get("X_BEARER_TOKEN", "")

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

QUERIES = [
    "#TemblorVenezuela lang:es -is:retweet",
    "#SismoVenezuela lang:es -is:retweet",
    "terremoto Venezuela daños 2026 -is:retweet",
    "sismo Venezuela edificio derrumbe -is:retweet",
    "Venezuela earthquake damage 2026 -is:retweet",
    "temblor Yumare OR Carabobo OR Valencia OR Caracas -is:retweet",
]

LOCATIONS = {
    "caracas": (10.4806, -66.9036), "valencia": (10.1620, -67.9903),
    "carabobo": (10.1620, -67.9903), "maracaibo": (10.6316, -71.6428),
    "barquisimeto": (10.0647, -69.3571), "maracay": (10.2469, -67.5958),
    "yumare": (10.6383, -68.6847), "san felipe": (10.3394, -68.7453),
    "yaracuy": (10.3394, -68.7453), "cumana": (10.4574, -64.1744),
    "merida": (8.5916, -71.1440), "maturin": (9.7450, -63.1800),
    "petare": (10.4800, -66.8000), "miranda": (10.3000, -66.6000),
    "vargas": (10.6000, -67.1000), "aragua": (10.2603, -67.5894),
    "lara": (10.0647, -69.3571), "falcon": (11.2, -69.7),
    "portuguesa": (9.0940, -69.4420), "ciudad bolivar": (8.1222, -63.5497),
}


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
    if any(w in t for w in ["grave", "severo", "serious"]):
        return 4
    if any(w in t for w in ["daño", "damage", "grieta", "afectad"]):
        return 3
    if any(w in t for w in ["sismo", "temblor", "terremoto", "earthquake"]):
        return 2
    return 1


def search_tweets(query: str, max_results: int = 50) -> list[dict]:
    if not X_BEARER:
        print("  [skip] X_BEARER_TOKEN not set")
        return []
    headers = {"Authorization": f"Bearer {X_BEARER}"}
    params = {
        "query": query,
        "max_results": max_results,
        "tweet.fields": "created_at,author_id,attachments,geo",
        "expansions": "author_id,attachments.media_keys",
        "media.fields": "url,preview_image_url",
        "user.fields": "username",
        "start_time": "2026-06-24T00:00:00Z",
    }
    try:
        r = httpx.get(
            "https://api.twitter.com/2/tweets/search/recent",
            headers=headers, params=params, timeout=15
        )
        r.raise_for_status()
        data = r.json()

        users = {u["id"]: u["username"] for u in data.get("includes", {}).get("users", [])}
        media = {m["media_key"]: m.get("url") or m.get("preview_image_url")
                 for m in data.get("includes", {}).get("media", [])}

        tweets = []
        for t in data.get("data", []):
            media_keys = t.get("attachments", {}).get("media_keys", [])
            tweets.append({
                "id": t["id"],
                "text": t["text"],
                "author": users.get(t.get("author_id", ""), ""),
                "created_at": t.get("created_at"),
                "media_urls": [media[k] for k in media_keys if k in media and media[k]],
            })
        return tweets
    except Exception as e:
        print(f"  [api error] {e}")
        return []


def push(tweet: dict) -> bool:
    text = tweet["text"]
    loc, lat, lng = extract_location(text)
    payload = {
        "source": "twitter",
        "source_url": f"https://x.com/i/web/status/{tweet['id']}",
        "source_id": tweet["id"],
        "author": tweet.get("author"),
        "text_content": text,
        "media_urls": tweet.get("media_urls", []),
        "lat": lat, "lng": lng,
        "location_name": loc,
        "damage_level": estimate_damage(text),
        "post_time": tweet.get("created_at"),
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


def main():
    if not X_BEARER:
        print("[twitter] X_BEARER_TOKEN not set — get one at developer.twitter.com (free)")
        print("          Then add to scrapers/.env: X_BEARER_TOKEN=AAAA...")
        return
    print(f"[twitter] {len(QUERIES)} queries")
    total = 0
    for q in QUERIES:
        print(f"  {q[:60]}")
        tweets = search_tweets(q)
        print(f"    {len(tweets)} tweets")
        for t in tweets:
            if push(t):
                total += 1
    print(f"[twitter] Done — {total} pushed")


if __name__ == "__main__":
    main()
