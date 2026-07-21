#!/usr/bin/env python3
"""
youtube.py — Search YouTube for Venezuela earthquake videos and push to Supabase.

Run: conda run -n agent python scrapers/youtube.py
"""
import os, json, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent / ".env")
from supabase import create_client
sys.path.insert(0, str(Path(__file__).parent))
from guardrails import is_credible, cap_damage

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

SEARCH_QUERIES = [
    "terremoto Venezuela junio 2026",
    "sismo Venezuela 24 junio 2026 daños",
    "Venezuela earthquake June 2026 damage",
    "temblor Venezuela Yumare San Felipe 2026",
    "Venezuela 7.5 earthquake 2026",
    "terremoto Venezuela edificios derrumbe 2026",
]

# Only ingest videos uploaded on or after this date
DATE_AFTER = "20260624"

VENEZUELA_LOCATIONS = {
    "caracas": (10.4806, -66.9036),
    "valencia": (10.1620, -67.9903),
    "carabobo": (10.1620, -67.9903),
    "maracaibo": (10.6316, -71.6428),
    "barquisimeto": (10.0647, -69.3571),
    "aragua": (10.2603, -67.5894),
    "miranda": (10.3000, -66.6000),
    "maturin": (9.7450, -63.1800),
    "cumana": (10.4574, -64.1744),
    "merida": (8.5916, -71.1440),
    "maracay": (10.2469, -67.5958),
    "petare": (10.4800, -66.8000),
}


def extract_location(text: str) -> tuple[str | None, float | None, float | None]:
    text_lower = text.lower()
    for place, (lat, lng) in VENEZUELA_LOCATIONS.items():
        if place in text_lower:
            return place.title(), lat, lng
    return None, None, None


def search_youtube(query: str, max_results: int = 15) -> list[dict]:
    yt_dlp = "/opt/homebrew/Caskroom/miniforge/base/envs/agent/bin/yt-dlp"
    result = subprocess.run(
        [
            yt_dlp,
            f"ytsearch{max_results}:{query}",
            "--dump-json", "--flat-playlist", "--no-download",
            "--dateafter", DATE_AFTER,
        ],
        capture_output=True, text=True, timeout=60,
        env={**os.environ, "PATH": "/opt/homebrew/bin:" + os.environ.get("PATH", "")},
    )
    videos = []
    for line in result.stdout.strip().splitlines():
        try:
            videos.append(json.loads(line))
        except Exception:
            pass
    return videos


def is_recent(video: dict) -> bool:
    upload_date = video.get("upload_date", "")
    if not upload_date or len(upload_date) != 8:
        return True  # can't tell, include it
    return upload_date >= DATE_AFTER


def push_report(video: dict) -> bool:
    title = video.get("title", "")
    description = video.get("description", "") or ""
    text = f"{title}. {description[:500]}"
    author = video.get("channel") or video.get("uploader") or ""
    ok, reason = is_credible(text, author)
    if not ok:
        print(f"  [guardrail] {reason}: {title[:60]}")
        return False
    video_id = video.get("id", "")
    url = f"https://www.youtube.com/watch?v={video_id}"
    thumbnail = video.get("thumbnail") or (
        f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg" if video_id else None
    )
    upload_date = video.get("upload_date")
    post_time = None
    if upload_date and len(upload_date) == 8:
        post_time = datetime.strptime(upload_date, "%Y%m%d").replace(tzinfo=timezone.utc).isoformat()

    location_name, lat, lng = extract_location(text)

    payload = {
        "source": "youtube",
        "source_url": url,
        "source_id": video_id,
        "author": video.get("channel") or video.get("uploader"),
        "text_content": title,
        "media_urls": [thumbnail] if thumbnail else [],
        "lat": lat,
        "lng": lng,
        "location_name": location_name,
        "damage_level": cap_damage(3, "youtube", author),
        "post_time": post_time,
    }

    try:
        sb.table("reports").upsert(payload, on_conflict="source_url").execute()
        return True
    except Exception as e:
        print(f"  [push error] {e}")
        return False


def main():
    print(f"[youtube scraper] Starting — {len(SEARCH_QUERIES)} queries")
    total = 0
    for query in SEARCH_QUERIES:
        print(f"  Searching: {query}")
        videos = search_youtube(query)
        recent = [v for v in videos if is_recent(v)]
        print(f"    Got {len(videos)} videos, {len(recent)} from 2026-06-24+")
        for v in recent:
            if push_report(v):
                total += 1
    print(f"[youtube scraper] Done — {total} reports pushed")


if __name__ == "__main__":
    main()
