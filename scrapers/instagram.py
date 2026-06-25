#!/usr/bin/env python3
"""
instagram.py — Scrape earthquake posts via instaloader and push to Supabase.

Setup (one-time):
  pip install instaloader
  instaloader --login YOUR_BURNER_ACCOUNT   # saves session to ~/.config/instaloader/

Run: python scrapers/instagram.py
"""
import os, json
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

try:
    import instaloader
    HAS_INSTALOADER = True
except ImportError:
    HAS_INSTALOADER = False

from supabase import create_client

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
IG_USERNAME = os.environ.get("IG_USERNAME", "")

HASHTAGS = [
    "TemblorVenezuela",
    "SismoVenezuela",
    "TemblorEnVenezuela",
    "VenezuelaEarthquake",
    "TerremotoVenezuela",
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
}

CUTOFF = datetime(2026, 6, 24, tzinfo=timezone.utc)


def extract_location(text):
    t = (text or "").lower()
    for place, (lat, lng) in LOCATIONS.items():
        if place in t:
            return place.title(), lat, lng
    return None, None, None


def estimate_damage(text):
    t = (text or "").lower()
    if any(w in t for w in ["colaps", "derrumb", "destrui", "cayó"]):
        return 5
    if any(w in t for w in ["grave", "severo"]):
        return 4
    if any(w in t for w in ["daño", "grieta", "afectad"]):
        return 3
    return 2


def push(post_url, author, caption, media_url, post_time):
    loc, lat, lng = extract_location(caption)
    payload = {
        "source": "instagram",
        "source_url": post_url,
        "author": author,
        "text_content": (caption or "")[:1000],
        "media_urls": [media_url] if media_url else [],
        "lat": lat, "lng": lng,
        "location_name": loc,
        "damage_level": estimate_damage(caption),
        "post_time": post_time.isoformat() if post_time else None,
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
    if not HAS_INSTALOADER:
        print("[instagram] instaloader not installed — run: pip install instaloader")
        return
    if not IG_USERNAME:
        print("[instagram] IG_USERNAME not set in scrapers/.env")
        print("  1. Create a burner Instagram account")
        print("  2. Run: instaloader --login YOUR_USERNAME  (saves session)")
        print("  3. Add to scrapers/.env: IG_USERNAME=your_username")
        return

    L = instaloader.Instaloader(download_pictures=False, download_videos=False,
                                  download_video_thumbnails=False, save_metadata=False,
                                  quiet=True)
    try:
        L.load_session_from_file(IG_USERNAME)
    except Exception:
        print(f"[instagram] No saved session for {IG_USERNAME} — run: instaloader --login {IG_USERNAME}")
        return

    total = 0
    for tag in HASHTAGS:
        print(f"  #{tag}")
        try:
            hashtag = instaloader.Hashtag.from_name(L.context, tag)
            for post in hashtag.get_posts():
                if post.date_utc < CUTOFF.replace(tzinfo=None):
                    break  # posts are newest-first, stop when we go past cutoff
                url = f"https://www.instagram.com/p/{post.shortcode}/"
                media = post.url if not post.is_video else post.video_url
                if push(url, post.owner_username, post.caption, media, post.date_utc.replace(tzinfo=timezone.utc)):
                    total += 1
                if total > 200:
                    break
        except Exception as e:
            print(f"  [error] {e}")

    print(f"[instagram] Done — {total} pushed")


if __name__ == "__main__":
    main()
