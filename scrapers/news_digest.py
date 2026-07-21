"""
Daily news digest for SismoVenezuela.
Pulls Venezuelan earthquake coverage via Google News RSS,
runs through Gemma 4 (Ollama, local inference), stores structured
digest in Supabase news_digest table.

Run:  conda run -n agent python scrapers/news_digest.py
Cron: daily via run_all.sh (once per day, minutes 0-9 of first hour cycle)

Requires: pip install feedparser httpx python-dateutil
"""

import os
import json
import re
import httpx
import feedparser
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).parent / ".env")

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

OLLAMA_URL   = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma4:12b-mlx")
TODAY        = datetime.now(timezone.utc).date().isoformat()

RSS_FEEDS = [
    "https://news.google.com/rss/search?q=terremoto+Venezuela+2026&hl=es-419&gl=VE&ceid=VE:es-419",
    "https://news.google.com/rss/search?q=sismo+Venezuela+Yaracuy&hl=es-419&gl=VE&ceid=VE:es-419",
    "https://news.google.com/rss/search?q=earthquake+Venezuela+2026&hl=en-US&gl=US&ceid=US:en",
]

MAX_ARTICLES = 20
MAX_AGE_DAYS = 2


def ollama(prompt: str, model: str = OLLAMA_MODEL, timeout: int = 600) -> str:
    resp = httpx.post(
        f"{OLLAMA_URL}/api/generate",
        json={"model": model, "prompt": prompt, "stream": False},
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()["response"].strip()


def fetch_articles() -> list[dict]:
    seen_titles: set[str] = set()
    articles: list[dict] = []
    cutoff = datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)

    for feed_url in RSS_FEEDS:
        try:
            feed = feedparser.parse(feed_url)
        except Exception as e:
            print(f"  [rss] failed {feed_url[:60]}: {e}")
            continue
        for entry in feed.entries:
            title = (entry.get("title") or "").strip()
            if not title or title in seen_titles:
                continue
            seen_titles.add(title)
            published = entry.get("published_parsed")
            if published:
                pub_dt = datetime(*published[:6], tzinfo=timezone.utc)
                if pub_dt < cutoff:
                    continue
            articles.append({
                "title":   title,
                "summary": re.sub(r"<[^>]+>", "", entry.get("summary") or "")[:400],
                "url":     entry.get("link", ""),
                "source":  entry.get("source", {}).get("title", ""),
            })
            if len(articles) >= MAX_ARTICLES:
                break
        if len(articles) >= MAX_ARTICLES:
            break

    print(f"  Fetched {len(articles)} articles")
    return articles


def extract_structured(articles: list[dict]) -> dict:
    articles_text = "\n\n".join(
        f"[{i+1}] {a['title']}\n{a['summary']}" for i, a in enumerate(articles)
    )

    prompt = f"""Eres un analista de desastres naturales. Analiza estos artículos de noticias sobre el doblete sísmico del 24 de junio de 2026 en Venezuela (M7.2 + M7.5).

ARTÍCULOS:
{articles_text}

Responde SOLO con un JSON válido con este formato exacto (sin texto adicional):
{{
  "deaths_confirmed": <número o null>,
  "injuries_confirmed": <número o null>,
  "infrastructure": "<estado de infraestructura en 1-2 oraciones>",
  "gov_response": "<acciones del gobierno en 1-2 oraciones>",
  "key_events": ["<evento clave 1>", "<evento clave 2>", "<evento clave 3>"],
  "es_summary": "<resumen de 2-3 oraciones en español>"
}}"""

    raw = ollama(prompt)

    # extract JSON block
    match = re.search(r"\{[\s\S]+\}", raw)
    if not match:
        raise ValueError(f"Gemma returned no JSON block: {raw[:200]}")
    return json.loads(match.group())


def translate_to_english(data: dict) -> dict:
    prompt = f"""Translate the following Venezuelan earthquake news summary from Spanish to English.
Respond ONLY with a JSON object (no extra text):

Input:
- es_summary: {data.get("es_summary", "")}
- infrastructure: {data.get("infrastructure", "")}
- gov_response: {data.get("gov_response", "")}
- key_events: {json.dumps(data.get("key_events", []), ensure_ascii=False)}

Output format:
{{
  "en_summary": "<2-3 sentence English summary>",
  "infrastructure_en": "<English translation>",
  "gov_response_en": "<English translation>",
  "key_events_en": ["<English event 1>", "<English event 2>", "<English event 3>"]
}}"""

    raw = ollama(prompt)
    match = re.search(r"\{[\s\S]+\}", raw)
    if not match:
        raise ValueError(f"Translation returned no JSON: {raw[:200]}")
    return json.loads(match.group())


def already_ran_today() -> bool:
    try:
        res = sb.table("news_digest").select("digest_date").eq("digest_date", TODAY).execute()
        return bool(res.data)
    except Exception as e:
        if "PGRST205" in str(e) or "schema cache" in str(e):
            print("  [SETUP] news_digest table not found.")
            print("  Apply supabase/migrations/20260707_news_digest.sql in Supabase SQL editor first.")
            raise SystemExit(1)
        raise


def run():
    print(f"News digest — {TODAY} — model: {OLLAMA_MODEL}")

    if already_ran_today():
        print("  Already ran today. Skipping.")
        return

    articles = fetch_articles()
    if not articles:
        print("  No articles found. Skipping.")
        return

    print("  Running Gemma 4 — Spanish extraction...")
    structured = extract_structured(articles)

    print("  Running Gemma 4 — English translation...")
    translated = translate_to_english(structured)

    row = {
        "digest_date":         TODAY,
        "deaths_confirmed":    structured.get("deaths_confirmed"),
        "injuries_confirmed":  structured.get("injuries_confirmed"),
        "infrastructure":      structured.get("infrastructure", ""),
        "gov_response":        structured.get("gov_response", ""),
        "key_events":          structured.get("key_events", []),
        "key_events_en":       translated.get("key_events_en", []),
        "es_summary":          structured.get("es_summary", ""),
        "en_summary":          translated.get("en_summary", ""),
        "sources":             [a["url"] for a in articles if a["url"]][:10],
        "raw_articles":        articles,
    }

    sb.table("news_digest").upsert(row, on_conflict="digest_date").execute()
    print(f"  Saved digest for {TODAY}")
    print(f"  ES: {row['es_summary'][:120]}...")
    print(f"  EN: {row['en_summary'][:120]}...")
    print(f"  Deaths: {row['deaths_confirmed']} | Injured: {row['injuries_confirmed']}")
    print(f"  Key events: {len(row['key_events'])}")


if __name__ == "__main__":
    run()
