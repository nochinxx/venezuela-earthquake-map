#!/usr/bin/env python3
"""
twitter_comments.py — Scrape replies to earthquake tweets and extract location mentions.

Uses Playwright logged-in X session. Gemma is the primary location extractor.

Run: conda run -n agent python scrapers/twitter_comments.py
"""
import os, sys, time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

from supabase import create_client
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).parent))
from guardrails import is_credible
from transcribe_youtube import keyword_location, gemma_location, GENERIC

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
PROFILE_DIR = Path.home() / "agent" / "browser-profile"

DAMAGE_SIGNALS = [
    "sentí", "senti", "caí", "cai", "cayó", "cayo", "colaps", "derrumb",
    "grieta", "daño", "dano", "destrui", "herido", "muerto", "fallecid",
    "damage", "crack", "fell", "collapsed", "injured", "killed", "felt",
]
COMMENT_DAMAGE_CAP = 3

REPLY_JS = """() => {
    // Replies sit in article[data-testid='tweet'] elements after the first one
    const articles = [...document.querySelectorAll("article[data-testid='tweet']")];
    return articles.slice(1).map(a => {
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
    }).filter(r => r.text.length > 5 && r.tweet_id);
}"""


def has_signal(text: str) -> bool:
    t = text.lower()
    return any(w in t for w in DAMAGE_SIGNALS)


def estimate_damage(text: str) -> int:
    t = text.lower()
    if any(w in t for w in ["colaps", "derrumb", "destrui", "cayó", "cayo", "fell", "collapsed"]):
        return COMMENT_DAMAGE_CAP
    if any(w in t for w in ["daño", "grieta", "damage", "crack", "herido"]):
        return 2
    return 1


def gemma_first(text: str):
    """Gemma as primary extractor; keyword match as fast fallback."""
    loc, lat, lng = gemma_location(text)
    if loc and loc.lower() not in GENERIC:
        return loc, lat, lng
    return keyword_location(text)


def scrape_replies(page, tweet_url: str) -> list[dict]:
    page.goto(tweet_url, timeout=30000)
    try:
        page.wait_for_selector("article[data-testid='tweet']", timeout=10000)
    except Exception:
        pass
    # Scroll to load more replies
    for _ in range(2):
        page.keyboard.press("End")
        time.sleep(1.5)
    return page.evaluate(REPLY_JS)


def main():
    # Get recent earthquake tweets from DB
    rows = sb.table("reports") \
        .select("source_url,source_id") \
        .eq("source", "twitter") \
        .eq("is_comment", False) \
        .limit(20) \
        .execute().data

    tweet_urls = [(r["source_url"], r.get("source_id", "")) for r in rows if r.get("source_url")]
    print(f"[twitter_comments] {len(tweet_urls)} tweets to check for replies")

    total = 0
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE_DIR), headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        page = ctx.new_page()
        page.set_extra_http_headers({"Accept-Language": "es,en;q=0.9"})

        for i, (tweet_url, tweet_id) in enumerate(tweet_urls[:12]):
            print(f"  [{i+1}/12] {tweet_url[-30:]}")
            try:
                replies = scrape_replies(page, tweet_url)
                print(f"    {len(replies)} replies")
                for reply in replies:
                    text = reply.get("text", "")
                    if not has_signal(text):
                        continue
                    ok, reason = is_credible(text, reply.get("author", ""))
                    if not ok:
                        continue
                    loc, lat, lng = gemma_first(text)
                    if not loc or loc.lower() in GENERIC:
                        continue
                    payload = {
                        "source": "twitter",
                        "source_url": reply["url"],
                        "source_id": reply["tweet_id"],
                        "author": reply.get("author", ""),
                        "text_content": f'💬 "{text[:400]}"',
                        "media_urls": [],
                        "lat": lat, "lng": lng,
                        "location_name": loc,
                        "damage_level": estimate_damage(text),
                        "post_time": reply.get("date") or None,
                        "credibility": "low",
                        "is_comment": True,
                        "parent_url": tweet_url,
                    }
                    try:
                        sb.table("reports").upsert(
                            {k: v for k, v in payload.items() if v is not None},
                            on_conflict="source_url"
                        ).execute()
                        total += 1
                        print(f"    → {loc} | {text[:60]}")
                    except Exception as e:
                        print(f"    [push error] {e}")
            except Exception as e:
                print(f"    [error] {e}")

        ctx.close()

    print(f"\n[twitter_comments] Done — {total} replies pushed")


if __name__ == "__main__":
    main()
