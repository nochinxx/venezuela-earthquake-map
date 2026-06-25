#!/usr/bin/env python3
"""
casualties.py — Scrape verified sources for death/injury counts and push to Supabase.

Sources (in priority order):
  Twitter accounts: @USEmbassyVE, @CruzRojaVzla, @davidplacer, @APLatam, @CNNEspanol
  Web: AP News, CNN, Reuters

Run: conda run -n agent python scrapers/casualties.py
Manual override: conda run -n agent python scrapers/casualties.py --deaths 5 --injured 120 --source "Cruz Roja Venezolana" --url "https://..."
"""
import os, re, sys, time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

from supabase import create_client
from playwright.sync_api import sync_playwright

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

PROFILE_DIR = Path.home() / "agent" / "browser-profile"

# Verified accounts — tweet text from these is trusted as sourced
VERIFIED_ACCOUNTS = [
    "@USEmbassyVE",
    "@CruzRojaVzla",
    "@davidplacer",
    "@APLatam",
    "@AP",
    "@CNNEspanol",
    "@CNN",
    "@Reuters",
    "@FUNVISIS",
    "@VTV_Vzla",
]

# Search queries to find casualty reports on X
SEARCHES = [
    "muertos terremoto Venezuela 2026 (from:USEmbassyVE OR from:CruzRojaVzla OR from:davidplacer OR from:APLatam OR from:CNNEspanol OR from:Reuters)",
    "muertos OR fallecidos OR víctimas terremoto Venezuela junio 2026 -is:retweet",
    "dead injured Venezuela earthquake 2026 -is:retweet",
    "heridos terremoto Venezuela 2026 -is:retweet",
]

NUMBER_WORDS = {
    "un": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
    "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10,
    "once": 11, "doce": 12, "trece": 13, "catorce": 14, "quince": 15,
    "veinte": 20, "treinta": 30, "cuarenta": 40, "cincuenta": 50,
    "cien": 100, "ciento": 100,
}

EXTRACT_JS = """() => {
    const articles = [...document.querySelectorAll("article[data-testid='tweet']")];
    return articles.map(article => {
        const textEl = article.querySelector("[data-testid='tweetText']");
        const timeEl = article.querySelector("time");
        const authorEl = article.querySelector("a[role='link'][href*='/'] span");
        const linkEl = article.querySelector("a[href*='/status/']");
        const href = linkEl ? linkEl.href : "";
        const match = href.match(/status\\/([0-9]+)/);
        return {
            text: textEl ? textEl.innerText.trim() : "",
            date: timeEl ? timeEl.getAttribute("datetime") : "",
            author: authorEl ? authorEl.innerText.trim() : "",
            tweet_id: match ? match[1] : "",
            url: href,
        };
    }).filter(t => t.text.length > 5 && t.tweet_id);
}"""


def extract_numbers(text: str) -> dict:
    """Extract death/injury/missing counts from text."""
    t = text.lower()
    result = {}

    def find_num(pattern):
        m = re.search(pattern, t)
        if not m:
            return None
        val = m.group(1).replace(",", "").replace(".", "")
        try:
            return int(val)
        except ValueError:
            return NUMBER_WORDS.get(val)

    # Deaths
    deaths = (
        find_num(r"(\d[\d,.]*)\s*(?:muertos?|fallecidos?|víctimas? mortales?|deaths?|killed|dead)")
        or find_num(r"(?:muertos?|fallecidos?|víctimas? mortales?|deaths?|killed|dead)[^\d]{0,20}(\d[\d,.]*)")
    )
    if deaths:
        result["deaths"] = deaths

    # Injured
    injured = (
        find_num(r"(\d[\d,.]*)\s*(?:heridos?|lesionados?|injured|wounded)")
        or find_num(r"(?:heridos?|lesionados?|injured|wounded)[^\d]{0,20}(\d[\d,.]*)")
    )
    if injured:
        result["injured"] = injured

    # Missing
    missing = (
        find_num(r"(\d[\d,.]*)\s*(?:desaparecidos?|missing)")
        or find_num(r"(?:desaparecidos?|missing)[^\d]{0,20}(\d[\d,.]*)")
    )
    if missing:
        result["missing"] = missing

    return result


def is_verified_source(author: str) -> bool:
    a = author.lower().lstrip("@")
    return any(v.lower().lstrip("@") in a for v in VERIFIED_ACCOUNTS)


def push_stat(deaths, injured, missing, source_name, source_url, auto=True):
    payload = {
        "source_name": source_name,
        "source_url": source_url,
        "auto_extracted": auto,
    }
    if deaths is not None:
        payload["deaths"] = deaths
    if injured is not None:
        payload["injured"] = injured
    if missing is not None:
        payload["missing"] = missing
    sb.table("casualty_stats").insert(payload).execute()


def get_latest() -> dict | None:
    rows = sb.table("casualty_stats").select("*").order("scraped_at", desc=True).limit(1).execute().data
    return rows[0] if rows else None


def scrape_x(page, query: str) -> list[dict]:
    import urllib.parse
    url = f"https://x.com/search?q={urllib.parse.quote(query)}&f=live"
    page.goto(url, timeout=30000)
    try:
        page.wait_for_selector("article[data-testid='tweet']", timeout=12000)
    except Exception:
        pass
    time.sleep(2)
    return page.evaluate(EXTRACT_JS)


def main():
    # Manual override mode
    if "--deaths" in sys.argv or "--injured" in sys.argv:
        import argparse
        parser = argparse.ArgumentParser()
        parser.add_argument("--deaths", type=int, default=None)
        parser.add_argument("--injured", type=int, default=None)
        parser.add_argument("--missing", type=int, default=None)
        parser.add_argument("--source", required=True)
        parser.add_argument("--url", default=None)
        args = parser.parse_args()
        push_stat(args.deaths, args.injured, args.missing, args.source, args.url, auto=False)
        print(f"[casualties] Manual update saved: {args.deaths} muertos, {args.injured} heridos — {args.source}")
        return

    print("[casualties] Scraping verified sources for casualty figures...")
    best = {"deaths": None, "injured": None, "missing": None, "source": None, "url": None}
    candidates = []

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        page = ctx.new_page()
        page.set_extra_http_headers({"Accept-Language": "es,en;q=0.9"})

        for query in SEARCHES:
            print(f"  Searching: {query[:70]}")
            try:
                tweets = scrape_x(page, query)
                print(f"    {len(tweets)} tweets")
                for t in tweets:
                    nums = extract_numbers(t["text"])
                    if not nums:
                        continue
                    verified = is_verified_source(t.get("author", ""))
                    candidates.append({
                        **nums,
                        "source": t.get("author", "X/Twitter"),
                        "url": t.get("url", ""),
                        "verified": verified,
                        "text": t["text"][:120],
                    })
            except Exception as e:
                print(f"  [error] {e}")

        ctx.close()

    if not candidates:
        print("[casualties] No casualty figures found")
        return

    # Prefer verified sources, then highest death count (conservative but informative)
    verified = [c for c in candidates if c["verified"]]
    pool = verified if verified else candidates
    # Pick the one with highest deaths mentioned by a verified source
    pool.sort(key=lambda c: (c.get("deaths") or 0), reverse=True)
    chosen = pool[0]

    print(f"\n  Best figure: {chosen.get('deaths')} muertos, {chosen.get('injured')} heridos")
    print(f"  Source: {chosen['source']} ({'verified' if chosen['verified'] else 'unverified'})")
    print(f"  Text: {chosen['text']}")

    push_stat(
        chosen.get("deaths"), chosen.get("injured"), chosen.get("missing"),
        chosen["source"], chosen["url"], auto=True
    )
    print("[casualties] Done")


if __name__ == "__main__":
    main()
