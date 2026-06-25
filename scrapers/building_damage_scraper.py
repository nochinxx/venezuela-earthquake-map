"""
building_damage_scraper.py — Pull building damage reports from partner sites.

Sources:
  terremotovenezuela.com  — Supabase `buildings` table (178 verified, damage_level: total/severo/parcial)
  terremotovenezuela.app  — public /api/reports endpoint (type=critical, rescue reports)

Run: conda run -n agent python scrapers/building_damage_scraper.py
"""
import os, sys, io, requests
from datetime import datetime, timezone
from dotenv import load_dotenv
from supabase import create_client

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, line_buffering=True)

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

TVZ_COM_URL  = "https://jckifxsdlnsvbztxydes.supabase.co"
TVZ_COM_KEY  = "sb_publishable_i7iEDrCVZcSt0k3RGFrY4g_WrtZBB4w"
TVZ_APP_URL  = "https://terremotovenezuela.app/api/reports"

DAMAGE_LABEL = {"total": "Derrumbe total", "severo": "Daño severo", "parcial": "Daño parcial"}


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
        parts = [p for p in [row.get("notes"), row.get("general_source"), row.get("trapped_names") and f"Atrapados: {row['trapped_names']}"] if p]
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


def fetch_tvzapp() -> list[dict]:
    resp = requests.get(TVZ_APP_URL, timeout=15)
    resp.raise_for_status()
    records = []
    for r in resp.json().get("reports", []):
        if r.get("type") != "critical":
            continue
        ts = r.get("createdAt")
        reported_at = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).isoformat() if ts else None
        photo = r.get("photoUrl")
        if photo and not photo.startswith("http"):
            photo = f"https://terremotovenezuela.app{photo}"
        records.append({
            "external_id": r["id"],
            "external_source": "terremotovenezuela.app",
            "lat": r["lat"],
            "lng": r["lng"],
            "place": r.get("place"),
            "damage_type": "critical",
            "affected": r.get("affected") or None,
            "needs": r.get("needs"),
            "photo_url": photo,
            "confirmations": r.get("confirmations", 0),
            "reported_at": reported_at,
        })
    return records


def upsert_all(records: list[dict], source_label: str):
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
    return new


def run():
    print(f"[building-damage] {datetime.now(timezone.utc).isoformat()}")
    total = 0

    print("  terremotovenezuela.com...")
    try:
        records = fetch_tvzcom()
        print(f"    fetched {len(records)} buildings")
        n = upsert_all(records, "terremotovenezuela.com")
        print(f"    upserted {n}")
        total += n
    except Exception as e:
        print(f"    error: {e}")

    print("  terremotovenezuela.app...")
    try:
        records = fetch_tvzapp()
        print(f"    fetched {len(records)} critical reports")
        n = upsert_all(records, "terremotovenezuela.app")
        print(f"    upserted {n}")
        total += n
    except Exception as e:
        print(f"    error: {e}")

    print(f"[building-damage] done — {total} upserted total")


if __name__ == "__main__":
    run()
