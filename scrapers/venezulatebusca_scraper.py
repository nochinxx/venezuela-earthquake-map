"""
Scraper for venezuelatebusca.com missing-persons database.
Uses their public Supabase API directly (anon key visible in page source).
Deduplicates against existing records using cedula (exact) and normalized name (fuzzy).

Syncs every 30 min via run_all.sh.

BEFORE FIRST RUN — run this SQL in Supabase Dashboard:
  ALTER TABLE missing_persons
    ADD COLUMN IF NOT EXISTS cedula text,
    ADD COLUMN IF NOT EXISTS normalized_name text,
    ADD COLUMN IF NOT EXISTS source2_id text,
    ADD COLUMN IF NOT EXISTS source2_url text,
    ADD COLUMN IF NOT EXISTS is_duplicate boolean DEFAULT false;

  CREATE INDEX IF NOT EXISTS missing_persons_cedula_idx
    ON missing_persons(cedula) WHERE cedula IS NOT NULL;
  CREATE INDEX IF NOT EXISTS missing_persons_normalized_name_idx
    ON missing_persons(normalized_name) WHERE normalized_name IS NOT NULL;
"""

import os, requests, unicodedata, time
from datetime import datetime, timezone
from difflib import SequenceMatcher
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

VTB_URL = "https://ihcnbvkwkiyxlkhuwapu.supabase.co"
VTB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloY25idmt3a2l5eGxraHV3YXB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNDQxNzcsImV4cCI6MjA5NzkyMDE3N30.-0hKS1VFaMFFpnCTzrl4Wj7XwfUVAfos6a0QTGzDtEY"
VTB_HEADERS = {"apikey": VTB_KEY, "Authorization": f"Bearer {VTB_KEY}"}

PAGE_SIZE = 1000

LOCATIONS: dict[str, tuple[float, float]] = {
    "la guaira": (10.6017, -66.9340), "guaira": (10.6017, -66.9340),
    "catia la mar": (10.5978, -67.0242), "catia": (10.5978, -67.0242),
    "playa grande": (10.5990, -67.0050), "caraballeda": (10.6213, -66.8590),
    "macuto": (10.6109, -66.8843), "tanaguarena": (10.6161, -66.8487),
    "tanaguarenas": (10.6161, -66.8487), "naiguata": (10.6277, -66.7495),
    "naiguatá": (10.6277, -66.7495), "los caracas": (10.6239, -66.6854),
    "caribe": (10.6050, -66.9200), "corales": (10.6213, -66.8590),
    "urimare": (10.6364, -66.6219), "carayaca": (10.5541, -67.1066),
    "chuspa": (10.6500, -66.5300), "osma": (10.6177, -66.8700),
    "osman": (10.6177, -66.8700), "mamo": (10.5842, -67.1367),
    "maiquetia": (10.5975, -66.9600), "maiquetía": (10.5975, -66.9600),
    "camuri": (10.6277, -66.7800), "vargas": (10.6017, -66.9340),
    "litoral": (10.6017, -66.9340), "caracas": (10.4806, -66.9036),
    "petare": (10.4805, -66.7832), "guarenas": (10.4637, -66.5393),
    "guatire": (10.4697, -66.5390), "los teques": (10.3453, -67.0363),
    "maracay": (10.2469, -67.5958), "valencia": (10.1620, -67.9903),
    "barquisimeto": (10.0647, -69.3571), "maracaibo": (10.6316, -71.6428),
}


def normalize_name(nombre: str, apellido: str = "") -> str:
    full = f"{nombre} {apellido}".strip().lower()
    nfkd = unicodedata.normalize("NFKD", full)
    ascii_str = "".join(c for c in nfkd if not unicodedata.combining(c))
    return " ".join(ascii_str.split())


def geocode(ubicacion: str) -> tuple[float, float] | None:
    lower = ubicacion.lower().strip()
    for key, coords in LOCATIONS.items():
        if key in lower:
            return coords
    return None


def name_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def fetch_all_vtb() -> list[dict]:
    items = []
    offset = 0
    while True:
        r = requests.get(
            f"{VTB_URL}/rest/v1/desaparecidos",
            params={"select": "*", "order": "created_at.asc", "limit": PAGE_SIZE, "offset": offset},
            headers=VTB_HEADERS,
            timeout=15,
        )
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        items.extend(batch)
        print(f"  Fetched {len(items)} from venezuelatebusca...")
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        time.sleep(0.3)
    return items


def load_existing_dedup_keys() -> tuple[dict[str, str], dict[str, str]]:
    """Returns (cedula→id, normalized_name→id) for existing records."""
    cedulas: dict[str, str] = {}
    names: dict[str, str] = {}
    offset = 0
    while True:
        rows = (
            sb.table("missing_persons")
            .select("id,cedula,normalized_name")
            .range(offset, offset + 999)
            .execute()
        )
        if not rows.data:
            break
        for r in rows.data:
            if r.get("cedula"):
                cedulas[r["cedula"]] = r["id"]
            if r.get("normalized_name"):
                names[r["normalized_name"]] = r["id"]
        if len(rows.data) < 1000:
            break
        offset += 1000
    return cedulas, names


BATCH_SIZE = 500
DEDUP_NAME_THRESHOLD = 0.88


def sync():
    print(f"[{datetime.now(timezone.utc).isoformat()}] Syncing venezuelatebusca.com...")
    items = fetch_all_vtb()
    print(f"  Total fetched: {len(items)}")

    cedula_index, name_index = load_existing_dedup_keys()
    print(f"  Existing dedup keys — cedulas: {len(cedula_index)}, names: {len(name_index)}")

    to_insert = []
    to_update_found = []  # (source_id, estado) where someone was found
    duplicates = 0

    for item in items:
        source2_id = item["id"]
        nombre = (item.get("nombre") or "").strip()
        apellido = (item.get("apellido") or "").strip()
        full_name = f"{nombre} {apellido}".strip()
        if not full_name:
            continue

        cedula = (item.get("cedula") or "").strip() or None
        norm_name = normalize_name(nombre, apellido)
        estado = item.get("estado", "desaparecido")

        # 1. Exact cedula match → definite duplicate
        if cedula and cedula in cedula_index:
            existing_id = cedula_index[cedula]
            # Update status and add source2 attribution
            sb.table("missing_persons").update({
                "status": "encontrado" if estado == "encontrado" else "sin-contacto",
                "source2_id": source2_id,
                "source2_url": "https://venezuelatebusca.com",
                "is_duplicate": True,
            }).eq("id", existing_id).execute()
            duplicates += 1
            continue

        # 2. High-similarity name match → likely duplicate
        is_dup = False
        if norm_name in name_index:
            existing_id = name_index[norm_name]
            sb.table("missing_persons").update({
                "source2_id": source2_id,
                "source2_url": "https://venezuelatebusca.com",
                "is_duplicate": True,
            }).eq("id", existing_id).execute()
            duplicates += 1
            is_dup = True
        else:
            # Check fuzzy against all names (expensive — only for small remaining sets)
            for existing_name in name_index:
                if name_similarity(norm_name, existing_name) >= DEDUP_NAME_THRESHOLD:
                    existing_id = name_index[existing_name]
                    sb.table("missing_persons").update({
                        "source2_id": source2_id,
                        "source2_url": "https://venezuelatebusca.com",
                        "is_duplicate": True,
                    }).eq("id", existing_id).execute()
                    duplicates += 1
                    is_dup = True
                    break

        if is_dup:
            continue

        # New unique record
        coords = geocode(item.get("ultima_ubicacion") or "")
        lat, lng = (coords[0], coords[1]) if coords else (None, None)

        to_insert.append({
            "name": full_name,
            "age": item.get("edad"),
            "last_seen_location": item.get("ultima_ubicacion"),
            "lat": lat,
            "lng": lng,
            "description": item.get("descripcion"),
            "contact_info": f"{item.get('reportado_por_nombre') or ''} {item.get('reportado_por_telefono') or ''}".strip() or None,
            "source_id": None,
            "photo_url": item.get("foto_url"),
            "status": "encontrado" if estado == "encontrado" else "sin-contacto",
            "external_source": "venezulatebusca",
            "cedula": cedula,
            "normalized_name": norm_name,
            "source2_id": source2_id,
            "source2_url": "https://venezuelatebusca.com",
        })
        # Add to local dedup index for subsequent items
        if cedula:
            cedula_index[cedula] = "pending"
        name_index[norm_name] = "pending"

    print(f"  To insert: {len(to_insert)}, duplicates merged: {duplicates}")

    inserted = 0
    for i in range(0, len(to_insert), BATCH_SIZE):
        batch = to_insert[i : i + BATCH_SIZE]
        # Remove columns that don't exist yet — graceful fallback
        try:
            sb.table("missing_persons").insert(batch).execute()
        except Exception:
            # If new columns don't exist, insert without them
            stripped = [{k: v for k, v in rec.items() if k in ("name", "age", "last_seen_location", "lat", "lng", "description", "contact_info", "photo_url", "status", "external_source")} for rec in batch]
            sb.table("missing_persons").insert(stripped).execute()
        inserted += len(batch)
        print(f"  Inserted {inserted}/{len(to_insert)}...")

    print(f"  Done — inserted: {inserted}, duplicates: {duplicates}")
    return inserted, duplicates


if __name__ == "__main__":
    sync()
