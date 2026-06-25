"""
building_damage_scraper.py — Pull verified building damage from terremotovenezuela.com.

Source: terremotovenezuela.com Supabase `buildings` table
  - 144+ verified entries with damage_level: total / severo / parcial
  - Maintained by the terremotovenezuela.com team

Run: conda run -n agent python scrapers/building_damage_scraper.py
"""
import os, sys, io, requests
from datetime import datetime, timezone
from dotenv import load_dotenv
from supabase import create_client

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, line_buffering=True)

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

TVZ_COM_URL = "https://jckifxsdlnsvbztxydes.supabase.co"
TVZ_COM_KEY = "sb_publishable_i7iEDrCVZcSt0k3RGFrY4g_WrtZBB4w"


def fetch_tvzcom() -> list[dict]:
    r = requests.get(
        f"{TVZ_COM_URL}/rest/v1/buildings?select=*&limit=500",
        headers={"apikey": TVZ_COM_KEY, "Authorization": f"Bearer {TVZ_COM_KEY}"},
        timeout=15,
    )
    r.raise_for_status()
    records = []
    for row in r.json():
        if not row.get("lat") or not row.get("lng"):
            continue
        parts = [p for p in [
            row.get("notes"),
            row.get("general_source"),
            row.get("trapped_names") and f"Atrapados: {row['trapped_names']}",
        ] if p]
        records.append({
            "external_id": row["id"],
            "external_source": "terremotovenezuela.com",
            "lat": row["lat"],
            "lng": row["lng"],
            "place": row.get("name"),
            "damage_type": row.get("damage_level"),
            "affected": None,
            "needs": " | ".join(parts) or None,
            "photo_url": row.get("main_photo_url"),
            "confirmations": 0,
            "reported_at": row.get("last_updated_at") or row.get("created_at"),
        })
    return records


def run():
    print(f"[building-damage] {datetime.now(timezone.utc).isoformat()}")

    print("  terremotovenezuela.com...")
    try:
        records = fetch_tvzcom()
        print(f"    fetched {len(records)} buildings")
    except Exception as e:
        print(f"    error: {e}")
        return

    upserted = 0
    for r in records:
        try:
            result = (
                sb.table("building_damage")
                .upsert(r, on_conflict="external_source,external_id", ignore_duplicates=False)
                .execute()
            )
            if result.data:
                upserted += 1
        except Exception as e:
            print(f"    upsert error {r.get('external_id')}: {e}")

    print(f"    upserted {upserted}")
    print(f"[building-damage] done — {upserted} upserted")


if __name__ == "__main__":
    run()
