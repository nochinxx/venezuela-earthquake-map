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

# Verified accounts to scrape directly (in priority order)
VERIFIED_TIMELINES = [
    ("davidplacer", "David Placer / CNN"),
    ("USEmbassyVE", "US Embassy Venezuela"),
    ("CruzRojaVzla", "Cruz Roja Venezolana"),
    ("APLatam", "AP Noticias"),
    ("Reuters", "Reuters"),
    ("CNNEspanol", "CNN en Español"),
    ("FUNVISIS", "FUNVISIS"),
    ("VTV_Vzla", "VTV Venezuela"),
    ("convzlacomando", "Comando Venezuela"),
    ("MariaCorinaYA", "María Corina Machado"),
    ("CarlaAngola", "Carla Angola"),
]

# AP News search as web fallback
AP_SEARCH_URL = "https://apnews.com/search?q=venezuela+earthquake&s=2"

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


def has_recent_manual_entry(within_hours: int = 24) -> bool:
    """Return True if a manual (auto_extracted=false) row exists within the last N hours."""
    from datetime import datetime, timedelta, timezone
    since = (datetime.now(timezone.utc) - timedelta(hours=within_hours)).isoformat()
    rows = (
        sb.table("casualty_stats")
        .select("id")
        .eq("auto_extracted", False)
        .gt("scraped_at", since)
        .limit(1)
        .execute()
        .data
    )
    return len(rows) > 0


def scrape_timeline(page, handle: str, source_label: str) -> list[dict]:
    """Scrape recent tweets from a specific verified account."""
    page.goto(f"https://x.com/{handle}", timeout=30000)
    try:
        page.wait_for_selector("article[data-testid='tweet']", timeout=12000)
    except Exception:
        pass
    time.sleep(2)
    tweets = page.evaluate(EXTRACT_JS)
    results = []
    for t in tweets:
        # Only care about recent earthquake-related tweets
        text = t.get("text", "").lower()
        if not any(w in text for w in ["terremoto", "sismo", "temblor", "earthquake", "muerto", "fallecido", "herido", "víctima", "dead", "killed", "injur"]):
            continue
        nums = extract_numbers(t["text"])
        if nums:
            results.append({**nums, "source": source_label, "url": t.get("url", ""), "text": t["text"][:150]})
    return results


def scrape_ap_web(page) -> list[dict]:
    """Scrape AP News search results for Venezuela earthquake casualty figures."""
    try:
        page.goto(AP_SEARCH_URL, timeout=30000)
        page.wait_for_load_state("domcontentloaded", timeout=10000)
        time.sleep(2)
        # Get all visible text from article previews
        text = page.evaluate("() => document.body.innerText")
        nums = extract_numbers(text)
        if nums:
            return [{**nums, "source": "AP News", "url": AP_SEARCH_URL, "text": text[:200]}]
    except Exception as e:
        print(f"  [ap web error] {e}")
    return []


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

    print("[casualties] Scraping verified timelines for casualty figures...")
    candidates = []

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE_DIR),
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        page = ctx.new_page()
        page.set_extra_http_headers({"Accept-Language": "es,en;q=0.9"})

        for handle, label in VERIFIED_TIMELINES:
            print(f"  @{handle}")
            try:
                found = scrape_timeline(page, handle, label)
                if found:
                    print(f"    → {found[0].get('deaths')} muertos, {found[0].get('injured')} heridos: {found[0]['text'][:80]}")
                    candidates.extend(found)
                else:
                    print(f"    → no figures")
            except Exception as e:
                print(f"    [error] {e}")

        # AP News web fallback
        print("  AP News (web)")
        try:
            found = scrape_ap_web(page)
            if found:
                print(f"    → {found[0].get('deaths')} muertos, {found[0].get('injured')} heridos")
                candidates.extend(found)
        except Exception as e:
            print(f"    [error] {e}")

        ctx.close()

    if not candidates:
        print("[casualties] No casualty figures found in verified sources")
        return

    # Don't override a manual entry with auto-scraped data
    if has_recent_manual_entry():
        print("[casualties] Manual entry exists — skipping auto-insert to avoid overriding verified figure")
        return

    # Prioritize: most deaths reported (verified sources only, then any)
    candidates.sort(key=lambda c: (c.get("deaths") or 0), reverse=True)
    chosen = candidates[0]

    print(f"\n  Best figure: {chosen.get('deaths')} muertos, {chosen.get('injured')} heridos")
    print(f"  Source: {chosen['source']}")
    print(f"  Text: {chosen['text'][:100]}")

    push_stat(
        chosen.get("deaths"), chosen.get("injured"), chosen.get("missing"),
        chosen["source"], chosen["url"], auto=True
    )
    print("[casualties] Saved")


if __name__ == "__main__":
    main()
