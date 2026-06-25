#!/usr/bin/env python3
"""
instagram.py — Scrape earthquake Instagram posts via yt-dlp and push to Supabase.

Setup (one-time):
  1. Log into Instagram in your browser (Chrome/Firefox)
  2. yt-dlp will read cookies directly from the browser — no manual export needed

Run: python scrapers/instagram.py
  Or with explicit cookies file:
  INSTAGRAM_COOKIES=/path/to/cookies.txt python scrapers/instagram.py
"""
import os, json, subprocess, tempfile, httpx
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

from supabase import create_client

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

YT_DLP = os.environ.get(
    "YT_DLP_PATH",
    "/opt/homebrew/Caskroom/miniforge/base/envs/agent/bin/yt-dlp"
)
IG_BROWSER = os.environ.get("IG_BROWSER", "chrome")  # chrome, firefox, safari
COOKIES_FILE = os.environ.get("INSTAGRAM_COOKIES", "")

HASHTAGS = [
    "TemblorVenezuela",
    "SismoVenezuela",
    "TemblorEnVenezuela",
    "TerremotoVenezuela",
    "VenezuelaEarthquake",
    "DañosVenezuela",
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
    "lara": (10.0647, -69.3571), "portuguesa": (9.0940, -69.4420),
    "aragua": (10.2603, -67.5894), "guarenas": (10.4667, -66.5333),
    "la guaira": (10.6013, -66.9337), "los teques": (10.3372, -67.0400),
}

CUTOFF_DATE = "20260624"


def extract_location(text):
    t = (text or "").lower()
    for place, (lat, lng) in LOCATIONS.items():
        if place in t:
            return place.title(), lat, lng
    return None, None, None


def estimate_damage(text):
    t = (text or "").lower()
    if any(w in t for w in ["colaps", "derrumb", "destrui", "cayó", "caído", "demolid"]):
        return 5
    if any(w in t for w in ["grave", "severo", "destrucc"]):
        return 4
    if any(w in t for w in ["daño", "grieta", "afectad", "rajad"]):
        return 3
    return 2


def build_yt_dlp_cmd(url: str) -> list[str]:
    cmd = [YT_DLP, url, "--dump-json", "--flat-playlist", "--no-download",
           "--dateafter", CUTOFF_DATE]
    if COOKIES_FILE:
        cmd += ["--cookies", COOKIES_FILE]
    else:
        cmd += ["--cookies-from-browser", IG_BROWSER]
    return cmd


def scrape_hashtag(tag: str) -> list[dict]:
    url = f"https://www.instagram.com/explore/tags/{tag}/"
    result = subprocess.run(
        build_yt_dlp_cmd(url),
        capture_output=True, text=True, timeout=60,
        env={**os.environ, "PATH": "/opt/homebrew/bin:" + os.environ.get("PATH", "")},
    )
    posts = []
    for line in result.stdout.strip().splitlines():
        try:
            posts.append(json.loads(line))
        except Exception:
            pass
    return posts


def push(post: dict) -> bool:
    title = post.get("title", "") or ""
    description = post.get("description", "") or ""
    caption = f"{title} {description}".strip()
    post_id = post.get("id", "")
    url = post.get("webpage_url") or f"https://www.instagram.com/p/{post_id}/"
    thumbnail = post.get("thumbnail")

    upload_date = post.get("upload_date", "")
    post_time = None
    if upload_date and len(upload_date) == 8:
        post_time = datetime.strptime(upload_date, "%Y%m%d").replace(tzinfo=timezone.utc).isoformat()
        if upload_date < CUTOFF_DATE:
            return False  # too old

    loc, lat, lng = extract_location(caption)
    payload = {
        "source": "instagram",
        "source_url": url,
        "source_id": post_id,
        "author": post.get("uploader") or post.get("channel"),
        "text_content": caption[:1000] or title,
        "media_urls": [thumbnail] if thumbnail else [],
        "lat": lat, "lng": lng,
        "location_name": loc,
        "damage_level": estimate_damage(caption),
        "post_time": post_time,
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
    print(f"[instagram] {len(HASHTAGS)} hashtags | browser: {IG_BROWSER}")
    total = 0
    for tag in HASHTAGS:
        print(f"  #{tag}")
        posts = scrape_hashtag(tag)
        print(f"    {len(posts)} posts found")
        for p in posts:
            if push(p):
                total += 1
    print(f"[instagram] Done — {total} pushed")


if __name__ == "__main__":
    main()
