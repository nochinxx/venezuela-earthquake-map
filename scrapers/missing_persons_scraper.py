"""
Scraper for desaparecidosterremotovenezuela.com missing-persons database.
Syncs to our missing_persons table every 30 min.

BEFORE FIRST RUN — paste this SQL in Supabase Dashboard > SQL Editor:
  ALTER TABLE missing_persons
    ADD COLUMN IF NOT EXISTS source_id text,
    ADD COLUMN IF NOT EXISTS photo_url text,
    ADD COLUMN IF NOT EXISTS status text DEFAULT 'sin-contacto',
    ADD COLUMN IF NOT EXISTS external_source text;
  CREATE UNIQUE INDEX IF NOT EXISTS missing_persons_source_id_idx
    ON missing_persons(source_id) WHERE source_id IS NOT NULL;
"""

import os, requests, time
from datetime import datetime, timezone
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

API_BASE = "https://desaparecidos-terremoto-api.theempire.tech/api/personas"

LOCATIONS: dict[str, tuple[float, float]] = {
    "la guaira": (10.6017, -66.9340),
    "guaira": (10.6017, -66.9340),
    "catia la mar": (10.5978, -67.0242),
    "catia": (10.5978, -67.0242),
    "playa grande": (10.5990, -67.0050),
    "caraballeda": (10.6213, -66.8590),
    "macuto": (10.6109, -66.8843),
    "tanaguarena": (10.6161, -66.8487),
    "tanaguarenas": (10.6161, -66.8487),
    "naiguata": (10.6277, -66.7495),
    "naiguatá": (10.6277, -66.7495),
    "los caracas": (10.6239, -66.6854),
    "caribe": (10.6050, -66.9200),
    "urimare": (10.6364, -66.6219),
    "carayaca": (10.5541, -67.1066),
    "chuspa": (10.6500, -66.5300),
    "osma": (10.6177, -66.8700),
    "osman": (10.6177, -66.8700),
    "mamo": (10.5842, -67.1367),
    "maiquetia": (10.5975, -66.9600),
    "maiquetía": (10.5975, -66.9600),
    "corales": (10.6213, -66.8590),
    "puerta del mar": (10.6050, -66.9200),
    "catita": (10.5978, -67.0242),
    "playa oma": (10.6150, -66.9000),
    "playa uma": (10.6150, -66.9000),
    "vargas": (10.6017, -66.9340),
    "litoral": (10.6017, -66.9340),
    "la guairá": (10.6017, -66.9340),
    "caracas": (10.4806, -66.9036),
    "petare": (10.4805, -66.7832),
    "palos grandes": (10.5040, -66.8558),
    "altamira": (10.4955, -66.8474),
    "chacao": (10.4942, -66.8516),
    "guarenas": (10.4637, -66.5393),
    "guatire": (10.4697, -66.5390),
    "los teques": (10.3453, -67.0363),
    "maracay": (10.2469, -67.5958),
    "valencia": (10.1620, -67.9903),
    "puerto cabello": (10.4792, -68.0017),
    "barquisimeto": (10.0647, -69.3571),
    "maracaibo": (10.6316, -71.6428),
    "mérida": (8.5916, -71.1440),
    "merida": (8.5916, -71.1440),
    "cumaná": (10.4574, -64.1744),
    "cumana": (10.4574, -64.1744),
    "barcelona": (10.1403, -64.6919),
    "puerto la cruz": (10.2123, -64.6335),
    "maturín": (9.7487, -63.1820),
    "maturin": (9.7487, -63.1820),
    "ciudad guayana": (8.3518, -62.6512),
}


def geocode(ubicacion: str) -> tuple[float, float] | None:
    lower = ubicacion.lower().strip()
    for key, coords in LOCATIONS.items():
        if key in lower:
            return coords
    return None


def fetch_all_pages() -> list[dict]:
    items = []
    page = 1
    page_size = 200
    while True:
        r = requests.get(API_BASE, params={"page": page, "pageSize": page_size}, timeout=15)
        r.raise_for_status()
        data = r.json()
        items.extend(data["items"])
        print(f"  Page {page}/{data['totalPages']} — {len(items)} fetched")
        if page >= data["totalPages"]:
            break
        page += 1
        time.sleep(0.5)
    return items


BATCH_SIZE = 500


def sync():
    print(f"[{datetime.now(timezone.utc).isoformat()}] Syncing desaparecidos...")
    items = fetch_all_pages()
    print(f"  Fetched {len(items)} records")

    # Fetch all existing source_ids in one query
    existing_ids: set[str] = set()
    existing_statuses: dict[str, str] = {}
    offset = 0
    while True:
        rows = (
            sb.table("missing_persons")
            .select("source_id,status")
            .not_.is_("source_id", "null")
            .range(offset, offset + 999)
            .execute()
        )
        if not rows.data:
            break
        for r in rows.data:
            existing_ids.add(r["source_id"])
            existing_statuses[r["source_id"]] = r.get("status") or ""
        if len(rows.data) < 1000:
            break
        offset += 1000

    print(f"  Existing in DB: {len(existing_ids)}")

    to_insert = []
    to_update = []  # (source_id, new_status)

    for item in items:
        source_id = item["id"]
        name = (item.get("nombre") or "").strip()
        if not name:
            continue

        coords = geocode(item.get("ubicacion") or "")
        lat, lng = (coords[0], coords[1]) if coords else (None, None)
        estado = item.get("estado", "sin-contacto")

        if source_id in existing_ids:
            if existing_statuses.get(source_id) != estado:
                to_update.append((source_id, estado))
        else:
            to_insert.append({
                "name": name,
                "age": item.get("edad"),
                "last_seen_location": item.get("ubicacion"),
                "lat": lat,
                "lng": lng,
                "description": item.get("descripcion"),
                "contact_info": item.get("contacto"),
                "source_id": source_id,
                "photo_url": item.get("foto"),
                "status": estado,
                "external_source": "desaparecidos-vzla",
            })

    # Deduplicate to_insert by source_id (API pagination may return same record twice)
    seen_source_ids: set[str] = set()
    deduped = []
    for rec in to_insert:
        sid = rec.get("source_id")
        if sid:
            if sid in seen_source_ids:
                continue
            seen_source_ids.add(sid)
        deduped.append(rec)
    to_insert = deduped

    print(f"  To insert: {len(to_insert)}, to update: {len(to_update)}")

    # Batch insert with per-record fallback on duplicate key errors
    inserted = 0
    for i in range(0, len(to_insert), BATCH_SIZE):
        batch = to_insert[i : i + BATCH_SIZE]
        try:
            sb.table("missing_persons").insert(batch).execute()
            inserted += len(batch)
        except Exception:
            # Batch has a duplicate — fall back to individual inserts, skip existing
            for rec in batch:
                try:
                    sb.table("missing_persons").insert(rec).execute()
                    inserted += 1
                except Exception:
                    pass  # already exists, skip
        if inserted % 1000 < BATCH_SIZE:
            print(f"  Inserted {inserted}/{len(to_insert)}...")

    # Updates one-by-one (typically very few status changes per run)
    for source_id, new_status in to_update:
        sb.table("missing_persons").update({"status": new_status}).eq("source_id", source_id).execute()

    print(f"  Done — inserted: {inserted}, updated: {len(to_update)}, skipped: {len(existing_ids) - len(to_update)}")
    return inserted, len(to_update)


if __name__ == "__main__":
    sync()
