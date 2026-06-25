#!/usr/bin/env python3
"""
youtube_comments.py — Extract location mentions from YouTube video comments.

yt-dlp downloads the comment JSON. We keyword-match + Gemma fallback
to find city/state mentions. Reports stored with credibility='low',
is_comment=True, parent_url=video_url.

Run: conda run -n agent python scrapers/youtube_comments.py
"""
import os, re, json, subprocess, tempfile, sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

from supabase import create_client
sys.path.insert(0, str(Path(__file__).parent))
from guardrails import is_credible
from transcribe_youtube import keyword_location, gemma_location, LOCATIONS, GENERIC

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

YT_DLP = "/opt/homebrew/Caskroom/miniforge/base/envs/agent/bin/yt-dlp"

# Only accept comments that mention a specific location + damage/shaking signal
DAMAGE_SIGNALS = [
    "sentí", "senti", "temblor", "sismo", "cayó", "cayo", "derrumb",
    "colaps", "grieta", "daño", "dano", "destrui", "herido", "muerto",
    "felt", "shook", "damage", "fell", "collapsed", "crack",
]

# Cap damage level for comment-sourced reports
COMMENT_DAMAGE_CAP = 3


def estimate_damage(text: str) -> int:
    t = text.lower()
    if any(w in t for w in ["colaps", "derrumb", "destrui", "cayó", "cayo", "fell", "collapsed"]):
        return COMMENT_DAMAGE_CAP  # cap at 3 for unverified comments
    if any(w in t for w in ["daño", "grieta", "damage", "crack", "herido"]):
        return 2
    return 1


def has_damage_signal(text: str) -> bool:
    t = text.lower()
    return any(w in t for w in DAMAGE_SIGNALS)


def fetch_comments(url: str, tmpdir: str) -> list[dict]:
    """Download comments JSON via yt-dlp."""
    result = subprocess.run(
        [
            YT_DLP, url,
            "--write-comments", "--skip-download",
            "--no-warnings", "--max-comments", "200,all,all,10",
            "-o", f"{tmpdir}/vid.%(ext)s",
        ],
        capture_output=True, text=True, timeout=60,
    )
    for f in Path(tmpdir).glob("*.info.json"):
        try:
            data = json.loads(f.read_text())
            return data.get("comments", [])
        except Exception:
            pass
    return []


def process_comment(comment: dict, video_url: str) -> dict | None:
    text = (comment.get("text") or "").strip()
    if not text or len(text) < 10:
        return None

    # Must mention a location AND have a damage/shaking signal
    if not has_damage_signal(text):
        return None

    ok, reason = is_credible(text)
    if not ok:
        return None

    loc, lat, lng = keyword_location(text)
    if not loc:
        # Only call Gemma if there's a clear damage signal (worth the cost)
        if any(w in text.lower() for w in ["cayó", "cayo", "colaps", "derrumb", "grieta", "daño"]):
            loc, lat, lng = gemma_location(text)

    if not loc or loc.lower() in GENERIC:
        return None

    author = comment.get("author") or comment.get("author_display_name") or ""
    comment_id = comment.get("id") or ""
    # YouTube comment URL: video_url&lc=COMMENT_ID
    comment_url = f"{video_url}&lc={comment_id}" if comment_id else video_url

    return {
        "source": "youtube",
        "source_url": comment_url,
        "source_id": comment_id,
        "author": author,
        "text_content": f'💬 Comentario: "{text[:400]}"',
        "media_urls": [],
        "lat": lat,
        "lng": lng,
        "location_name": loc,
        "damage_level": estimate_damage(text),
        "post_time": None,
        "credibility": "low",
        "is_comment": True,
        "parent_url": video_url,
    }


def main():
    # Get YouTube videos with most reports (prioritise popular ones)
    rows = sb.table("reports") \
        .select("source_url") \
        .eq("source", "youtube") \
        .eq("is_comment", False) \
        .limit(20) \
        .execute().data

    video_urls = list({r["source_url"] for r in rows})
    print(f"[youtube_comments] {len(video_urls)} videos to check")

    total_pushed = 0
    for i, url in enumerate(video_urls[:15]):  # cap at 15 videos per run
        vid_id = url.split("v=")[-1]
        print(f"  [{i+1}/{min(len(video_urls),15)}] {vid_id}")
        try:
            with tempfile.TemporaryDirectory() as tmp:
                comments = fetch_comments(url, tmp)
            print(f"    {len(comments)} comments downloaded")
            pushed = 0
            for c in comments:
                payload = process_comment(c, url)
                if not payload:
                    continue
                try:
                    sb.table("reports").upsert(
                        {k: v for k, v in payload.items() if v is not None},
                        on_conflict="source_url"
                    ).execute()
                    pushed += 1
                    total_pushed += 1
                    print(f"    → {payload['location_name']} ({payload['lat']:.3f}, {payload['lng']:.3f}) [{payload['text_content'][:60]}]")
                except Exception as e:
                    print(f"    [push error] {e}")
        except Exception as e:
            print(f"    [error] {e}")

    print(f"\n[youtube_comments] Done — {total_pushed} comments pushed to map")


if __name__ == "__main__":
    main()
