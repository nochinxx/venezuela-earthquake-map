#!/usr/bin/env python3
"""
instagram_search.py — Scrape Instagram earthquake hashtags via Playwright.

First run: logs into Instagram and saves session to the browser profile.
Subsequent runs: reuses saved session, headless.

First time setup:
  conda run -n agent python scrapers/instagram_search.py --login

Run: conda run -n agent python scrapers/instagram_search.py
"""
import os, json, time, sys
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

from supabase import create_client
from playwright.sync_api import sync_playwright

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

IG_USERNAME = os.environ.get("IG_USERNAME", "")
IG_PASSWORD = os.environ.get("IG_PASSWORD", "")

# Separate profile so Instagram session doesn't interfere with X session
PROFILE_DIR = Path.home() / "agent" / "browser-profile-instagram"
PROFILE_DIR.mkdir(parents=True, exist_ok=True)

HASHTAGS = [
    "TemblorVenezuela",
    "SismoVenezuela",
    "TemblorEnVenezuela",
    "TerremotoVenezuela",
    "VenezuelaEarthquake",
]

LOCATIONS = {
    "caracas": (10.4806, -66.9036), "valencia": (10.1620, -67.9903),
    "carabobo": (10.1620, -67.9903), "maracaibo": (10.6316, -71.6428),
    "barquisimeto": (10.0647, -69.3571), "maracay": (10.2469, -67.5958),
    "yumare": (10.6383, -68.6847), "san felipe": (10.3394, -68.7453),
    "yaracuy": (10.3394, -68.7453), "merida": (8.5916, -71.1440),
    "maturin": (9.7450, -63.1800), "petare": (10.4800, -66.8000),
    "miranda": (10.3000, -66.6000), "vargas": (10.6000, -67.1000),
    "cumana": (10.4574, -64.1744), "aragua": (10.2603, -67.5894),
}

CUTOFF = "2026-06-24"

EXTRACT_JS = """() => {
    // Search/hashtag page: grab all /p/ links, deduplicate by shortcode
    const seen = new Set();
    const posts = [];
    for (const a of document.querySelectorAll("a[href*='/p/']")) {
        const m = a.href.match(/\\/p\\/([^/?]+)/);
        if (!m) continue;
        const code = m[1];
        if (seen.has(code)) continue;
        seen.add(code);
        const img = a.querySelector("img");
        posts.push({
            shortcode: code,
            url: "https://www.instagram.com/p/" + code + "/",
            img: img ? img.src : "",
            alt: img ? img.alt : "",
        });
    }
    return posts;
}"""

POST_EXTRACT_JS = """() => {
    const caption = document.querySelector("h1, [data-testid='post-caption'], ._a9zs");
    const time = document.querySelector("time");
    const author = document.querySelector("header a");
    return {
        caption: caption ? caption.innerText : document.title,
        date: time ? time.getAttribute("datetime") : "",
        author: author ? author.innerText : "",
    };
}"""


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


def push(url, author, caption, img, date_str) -> bool:
    if date_str and date_str[:10] < CUTOFF:
        return False
    loc, lat, lng = extract_location(caption)
    payload = {
        "source": "instagram",
        "source_url": url,
        "author": author,
        "text_content": (caption or "")[:1000],
        "media_urls": [img] if img else [],
        "lat": lat, "lng": lng,
        "location_name": loc,
        "damage_level": estimate_damage(caption),
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


def login(page):
    print("  Logging into Instagram...")
    page.goto("https://www.instagram.com/accounts/login/", timeout=30000)
    # Dismiss cookie consent if present
    try:
        page.click("button:has-text('Allow')", timeout=5000)
    except Exception:
        pass
    try:
        page.click("button:has-text('Accept')", timeout=3000)
    except Exception:
        pass
    # Wait for login form (Instagram uses name='email' and name='pass')
    page.wait_for_selector("input[name='email'], input[name='username']", timeout=30000)
    username_field = "input[name='email']" if page.query_selector("input[name='email']") else "input[name='username']"
    password_field = "input[name='pass']" if page.query_selector("input[name='pass']") else "input[name='password']"
    page.fill(username_field, IG_USERNAME)
    page.fill(password_field, IG_PASSWORD)
    page.click("button[type='submit'], input[type='submit']")
    # Wait until redirected away from login
    try:
        page.wait_for_url("**/instagram.com/**", timeout=30000)
        page.wait_for_selector("svg[aria-label='Home'], [data-testid='mobile-nav-logged-in']", timeout=15000)
    except Exception:
        pass
    print(f"  Logged in — current URL: {page.url}")


def scrape_hashtag(page, tag: str) -> int:
    # Instagram redirects /explore/tags/ to /explore/search/keyword/
    page.goto(f"https://www.instagram.com/explore/search/keyword/?q=%23{tag}", timeout=30000)
    try:
        page.wait_for_selector("a[href*='/p/']", timeout=12000)
    except Exception:
        pass
    time.sleep(2)

    posts = page.evaluate(EXTRACT_JS)
    print(f"    {len(posts)} posts visible")
    pushed = 0
    for post in posts[:20]:  # top 20 per hashtag
        try:
            page.goto(post["url"], timeout=20000)
            page.wait_for_load_state("networkidle", timeout=10000)
            meta = page.evaluate(POST_EXTRACT_JS)
            if push(post["url"], meta.get("author"), meta.get("caption"),
                    post.get("img"), meta.get("date")):
                pushed += 1
            time.sleep(1)  # polite delay
        except Exception as e:
            print(f"    [skip] {e}")
    return pushed


def main():
    login_mode = "--login" in sys.argv

    if login_mode and not (IG_USERNAME and IG_PASSWORD):
        print("[instagram] Set IG_USERNAME and IG_PASSWORD in scrapers/.env first")
        return

    print(f"[instagram_search] {len(HASHTAGS)} hashtags | login_mode={login_mode}")
    total = 0

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            headless=not login_mode,
            args=["--no-sandbox"],
        )
        page = context.new_page()

        if login_mode:
            login(page)
            print("Session saved. Run without --login next time.")
            context.close()
            return

        for tag in HASHTAGS:
            print(f"  #{tag}")
            try:
                pushed = scrape_hashtag(page, tag)
                total += pushed
                print(f"    pushed {pushed}")
            except Exception as e:
                print(f"  [error] {e}")

        context.close()
    print(f"[instagram_search] Done — {total} pushed")


if __name__ == "__main__":
    main()
