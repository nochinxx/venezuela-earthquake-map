#!/usr/bin/env python3
"""
instagram_comments.py — Scrape comments from Instagram earthquake posts and extract locations.

Uses saved Instagram Playwright session. Gemma is primary location extractor.

Run: conda run -n agent python scrapers/instagram_comments.py
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
PROFILE_DIR = Path.home() / "agent" / "browser-profile-instagram"

DAMAGE_SIGNALS = [
    "sentí", "senti", "cayó", "cayo", "colaps", "derrumb", "grieta",
    "daño", "dano", "destrui", "herido", "muerto", "fallecid",
    "felt", "crack", "damage", "collapsed", "injured",
]
COMMENT_DAMAGE_CAP = 3

COMMENTS_JS = """() => {
    // Instagram post comments: ul > li structure
    const items = [...document.querySelectorAll("ul li")];
    const comments = [];
    for (const li of items) {
        const spans = li.querySelectorAll("span");
        const authorEl = li.querySelector("a[role='link']");
        let text = "";
        for (const s of spans) {
            const t = s.innerText.trim();
            if (t.length > 10 && !t.startsWith("#") && !t.includes("Like") && !t.includes("Reply")) {
                text = t;
                break;
            }
        }
        if (text && authorEl) {
            comments.push({
                text,
                author: authorEl.innerText.replace("@","").trim(),
            });
        }
    }
    return comments.slice(0, 50);
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
    """Gemma as primary; keyword as quick fallback."""
    loc, lat, lng = gemma_location(text)
    if loc and loc.lower() not in GENERIC:
        return loc, lat, lng
    return keyword_location(text)


def scrape_post_comments(page, post_url: str) -> list[dict]:
    page.goto(post_url, timeout=30000)
    try:
        page.wait_for_selector("ul li", timeout=10000)
    except Exception:
        pass
    time.sleep(2)
    # Scroll comment section to load more
    try:
        comment_section = page.query_selector("ul")
        if comment_section:
            for _ in range(2):
                comment_section.evaluate("el => el.scrollTop += 500")
                time.sleep(1)
    except Exception:
        pass
    return page.evaluate(COMMENTS_JS)


def main():
    rows = sb.table("reports") \
        .select("source_url") \
        .eq("source", "instagram") \
        .eq("is_comment", False) \
        .limit(20) \
        .execute().data

    post_urls = [r["source_url"] for r in rows if r.get("source_url")]
    print(f"[instagram_comments] {len(post_urls)} posts to check")

    total = 0
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE_DIR), headless=True,
            args=["--no-sandbox"],
        )
        page = ctx.new_page()

        for i, post_url in enumerate(post_urls[:12]):
            shortcode = post_url.rstrip("/").split("/")[-1]
            print(f"  [{i+1}/12] {shortcode}")
            try:
                comments = scrape_post_comments(page, post_url)
                print(f"    {len(comments)} comments")
                for c in comments:
                    text = c.get("text", "")
                    author = c.get("author", "")
                    if not has_signal(text):
                        continue
                    ok, reason = is_credible(text, author)
                    if not ok:
                        continue
                    loc, lat, lng = gemma_first(text)
                    if not loc or loc.lower() in GENERIC:
                        continue
                    # Use post URL + author as unique key (no comment ID from IG)
                    comment_url = f"{post_url}?comment={author[:20]}"
                    payload = {
                        "source": "instagram",
                        "source_url": comment_url,
                        "author": author,
                        "text_content": f'💬 "{text[:400]}"',
                        "media_urls": [],
                        "lat": lat, "lng": lng,
                        "location_name": loc,
                        "damage_level": estimate_damage(text),
                        "credibility": "low",
                        "is_comment": True,
                        "parent_url": post_url,
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

    print(f"\n[instagram_comments] Done — {total} location comments pushed")


if __name__ == "__main__":
    main()
