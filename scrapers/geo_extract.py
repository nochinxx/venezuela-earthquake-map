#!/usr/bin/env python3
"""
geo_extract.py — Re-process reports with null lat/lng using Gemma to extract location.

Run after scraping to fill in missing coordinates.
Run: conda run -n agent python scrapers/geo_extract.py
"""
import os, json, httpx, subprocess
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

VENEZUELA_LOCATIONS = {
    "caracas": (10.4806, -66.9036),
    "valencia": (10.1620, -67.9903),
    "maracaibo": (10.6316, -71.6428),
    "barquisimeto": (10.0647, -69.3571),
    "carabobo": (10.1620, -67.9903),
    "aragua": (10.2603, -67.5894),
    "miranda": (10.3000, -66.6000),
    "vargas": (10.6000, -67.1000),
    "maturin": (9.7450, -63.1800),
    "barcelona": (10.1333, -64.6833),
    "cumana": (10.4574, -64.1744),
    "merida": (8.5916, -71.1440),
    "san cristobal": (7.7653, -72.2254),
    "maracay": (10.2469, -67.5958),
    "ciudad bolivar": (8.1222, -63.5497),
    "puerto la cruz": (10.2131, -64.6347),
    "el tigre": (8.8884, -64.2496),
    "petare": (10.4800, -66.8000),
    "guarenas": (10.4667, -66.5333),
    "guatire": (10.4750, -66.5333),
    "los teques": (10.3372, -67.0400),
    "la guaira": (10.6013, -66.9337),
    "puerto cabello": (10.4681, -68.0097),
    "coro": (11.4052, -69.6732),
    "san felipe": (10.3394, -68.7453),
}


def ask_gemma(prompt: str) -> str:
    result = subprocess.run(
        ["conda", "run", "-n", "agent", "ollama", "run", "gemma3:4b"],
        input=prompt, capture_output=True, text=True, timeout=30,
    )
    return result.stdout.strip()


def extract_location_gemma(text: str) -> tuple[str | None, float | None, float | None]:
    prompt = (
        "Extract the Venezuelan city or state mentioned in this social media post. "
        "Reply with ONLY the place name in Spanish, nothing else. "
        "If no Venezuelan location is mentioned, reply: NONE\n\n"
        f"Post: {text[:500]}"
    )
    reply = ask_gemma(prompt).strip().lower()
    if reply == "none" or not reply:
        return None, None, None
    for place, (lat, lng) in VENEZUELA_LOCATIONS.items():
        if place in reply or reply in place:
            return place.title(), lat, lng
    return reply.title(), None, None


def main():
    result = supabase.table("reports").select("id,text_content").is_("lat", "null").limit(100).execute()
    rows = result.data or []
    print(f"[geo_extract] {len(rows)} reports without coordinates")

    updated = 0
    for row in rows:
        text = row.get("text_content", "") or ""
        if not text.strip():
            continue
        location_name, lat, lng = extract_location_gemma(text)
        if lat and lng:
            supabase.table("reports").update({
                "location_name": location_name,
                "lat": lat,
                "lng": lng,
            }).eq("id", row["id"]).execute()
            updated += 1
            print(f"  ✓ {row['id'][:8]}... → {location_name} ({lat}, {lng})")
        else:
            print(f"  - {row['id'][:8]}... → no location found")

    print(f"[geo_extract] Done — {updated}/{len(rows)} updated")


if __name__ == "__main__":
    main()
