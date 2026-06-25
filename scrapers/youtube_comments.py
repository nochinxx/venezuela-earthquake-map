#!/usr/bin/env python3
"""
youtube_comments.py — Fetch YouTube comments via Data API v3 and find location mentions.

Requires: YOUTUBE_API_KEY in scrapers/.env
Get one free at: console.cloud.google.com → APIs → YouTube Data API v3 → Credentials

Run: conda run -n agent python scrapers/youtube_comments.py
"""
import os, re, json, sys, httpx
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

from supabase import create_client
sys.path.insert(0, str(Path(__file__).parent))
from guardrails import is_credible
from transcribe_youtube import keyword_location, gemma_location, GENERIC

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "")
COMMENT_CAP = 3  # max damage level for comment-sourced reports

DAMAGE_SIGNALS = [
    "sentí", "senti", "temblor", "sismo", "cayó", "cayo", "derrumb",
    "colaps", "grieta", "daño", "dano", "destrui", "herido", "muerto",
    "fell", "collapsed", "damage", "crack", "shook", "felt it",
]


def has_signal(text: str) -> bool:
    t = text.lower()
    return any(w in t for w in DAMAGE_SIGNALS)


def estimate_damage(text: str) -> int:
    t = text.lower()
    if any(w in t for w in ["colaps", "derrumb", "destrui", "cayó", "cayo", "fell", "collapsed"]):
        return COMMENT_CAP
    if any(w in t for w in ["daño", "grieta", "damage", "crack", "herido"]):
        return 2
    return 1


def get_comments(video_id: str, max_results: int = 100) -> list[dict]:
    if not YOUTUBE_API_KEY:
        return []
    try:
        r = httpx.get(
            "https://www.googleapis.com/youtube/v3/commentThreads",
            params={
                "part": "snippet",
                "videoId": video_id,
                "maxResults": max_results,
                "order": "relevance",
                "key": YOUTUBE_API_KEY,
                "textFormat": "plainText",
            },
            timeout=15,
        )
        r.raise_for_status()
        items = r.json().get("items", [])
        return [
            {
                "id": item["id"],
                "text": item["snippet"]["topLevelComment"]["snippet"]["textDisplay"],
                "author": item["snippet"]["topLevelComment"]["snippet"]["authorDisplayName"],
                "like_count": item["snippet"]["topLevelComment"]["snippet"].get("likeCount", 0),
            }
            for item in items
        ]
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 403:
            print(f"    [api] comments disabled on this video")
        else:
            print(f"    [api error] {e.response.status_code}")
        return []
    except Exception as e:
        print(f"    [error] {e}")
        return []


def process_comment(comment: dict, video_url: str, video_id: str) -> dict | None:
    text = (comment.get("text") or "").strip()
    if not text or len(text) < 10 or not has_signal(text):
        return None

    ok, reason = is_credible(text)
    if not ok:
        return None

    loc, lat, lng = keyword_location(text)
    if not loc:
        if any(w in text.lower() for w in ["cayó", "cayo", "colaps", "derrumb", "grieta", "daño"]):
            loc, lat, lng = gemma_location(text)

    if not loc or loc.lower() in GENERIC:
        return None

    comment_id = comment.get("id", "")
    comment_url = f"https://www.youtube.com/watch?v={video_id}&lc={comment_id}"
    author = comment.get("author", "")

    return {
        "source": "youtube",
        "source_url": comment_url,
        "source_id": comment_id,
        "author": author,
        "text_content": f'💬 "{text[:400]}"',
        "media_urls": [],
        "lat": lat,
        "lng": lng,
        "location_name": loc,
        "damage_level": estimate_damage(text),
        "credibility": "low",
        "is_comment": True,
        "parent_url": video_url,
    }


def main():
    if not YOUTUBE_API_KEY:
        print("[youtube_comments] YOUTUBE_API_KEY not set — get one free at console.cloud.google.com")
        print("  Add to scrapers/.env: YOUTUBE_API_KEY=AIza...")
        return

    rows = sb.table("reports") \
        .select("source_url") \
        .eq("source", "youtube") \
        .eq("is_comment", False) \
        .limit(20) \
        .execute().data

    video_urls = list({r["source_url"] for r in rows})
    print(f"[youtube_comments] {len(video_urls)} videos to check")

    total = 0
    for i, url in enumerate(video_urls[:15]):
        vid_id = url.split("v=")[-1].split("&")[0]
        print(f"  [{i+1}/{min(len(video_urls),15)}] {vid_id}")
        comments = get_comments(vid_id)
        print(f"    {len(comments)} comments")
        for c in comments:
            payload = process_comment(c, url, vid_id)
            if not payload:
                continue
            try:
                sb.table("reports").upsert(
                    {k: v for k, v in payload.items() if v is not None},
                    on_conflict="source_url"
                ).execute()
                total += 1
                print(f"    → {payload['location_name']} | {payload['text_content'][:60]}")
            except Exception as e:
                print(f"    [push error] {e}")

    print(f"\n[youtube_comments] Done — {total} location comments pushed")


if __name__ == "__main__":
    main()
