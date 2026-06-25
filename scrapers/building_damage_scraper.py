"""
building_damage_scraper.py — Pull critical/rescue reports from partner sites.

Sources:
  terremotovenezuela.app  — public /api/reports endpoint (type=critical)

Run: conda run -n agent python scrapers/building_damage_scraper.py
"""
import os, sys, io, requests
from datetime import datetime, timezone
from dotenv import load_dotenv
from supabase import create_client

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, line_buffering=True)

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

SOURCES = [
    {
        "key": "tvzapp",
        "label": "terremotovenezuela.app",
        "url": "https://terremotovenezuela.app/api/reports",
        "types": ["critical"],
    },
]


def fetch_tvzapp(source: dict) -> list[dict]:
    resp = requests.get(source["url"], timeout=15)
    resp.raise_for_status()
    data = resp.json()
    records = []
    for r in data.get("reports", []):
        if r.get("type") not in source["types"]:
            continue
        reported_at = None
        ts = r.get("createdAt")
        if ts:
            reported_at = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).isoformat()
        photo = r.get("photoUrl")
        if photo and not photo.startswith("http"):
            photo = f"https://terremotovenezuela.app{photo}"
        records.append({
            "external_id": r["id"],
            "external_source": source["label"],
            "lat": r["lat"],
            "lng": r["lng"],
            "place": r.get("place"),
            "damage_type": r.get("type"),
            "affected": r.get("affected") or None,
            "needs": r.get("needs"),
            "photo_url": photo,
            "confirmations": r.get("confirmations", 0),
            "reported_at": reported_at,
        })
    return records


FETCHERS = {
    "tvzapp": fetch_tvzapp,
}


def run():
    print(f"[building-damage] {datetime.now(timezone.utc).isoformat()}")
    total_new = 0

    for source in SOURCES:
        print(f"  {source['label']}...")
        try:
            records = FETCHERS[source["key"]](source)
            print(f"    fetched {len(records)} critical records")
        except Exception as e:
            print(f"    error: {e}")
            continue

        new = 0
        for r in records:
            try:
                result = (
                    sb.table("building_damage")
                    .upsert(r, on_conflict="external_source,external_id", ignore_duplicates=False)
                    .execute()
                )
                if result.data:
                    new += 1
            except Exception as e:
                print(f"    upsert error {r.get('external_id')}: {e}")

        print(f"    upserted {new} records")
        total_new += new

    print(f"[building-damage] done — {total_new} upserted")


if __name__ == "__main__":
    run()
