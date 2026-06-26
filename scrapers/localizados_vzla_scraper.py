#!/usr/bin/env python3
"""
Syncs localizadosvenezuela.com → missing_persons DB.

Fetches all published localizados from their public API and cross-references
against our missing_persons table using the same cedula/fuzzy logic as
match_hospital_list.py.

Run:
  conda run -n earthquake python scrapers/localizados_vzla_scraper.py --dry-run
  conda run -n earthquake python scrapers/localizados_vzla_scraper.py
  conda run -n earthquake python scrapers/localizados_vzla_scraper.py --reset  # reprocess all
"""

import os, sys, json, time, argparse
from pathlib import Path
from dotenv import load_dotenv
import httpx

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

# Import shared logic from match_hospital_list
sys.path.insert(0, str(Path(__file__).parent))

from supabase import create_client

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

BASE_URL = "https://localizadosvenezuela.com"
STATE_FILE = Path(__file__).parent / "localizados_vzla_state.json"
PAGE_SIZE = 100


def fetch_all_records() -> list[dict]:
    records = []
    page = 1
    while True:
        r = httpx.get(
            f"{BASE_URL}/api/v1/localizados",
            params={"page": page, "limit": PAGE_SIZE},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        batch = data.get("data", [])
        if not batch:
            break
        records.extend(batch)
        meta = data.get("meta", {})
        total_pages = meta.get("totalPages", 1)
        print(f"  fetched page {page}/{total_pages} — {len(records)} so far", end="\r")
        if page >= total_pages:
            break
        page += 1
        time.sleep(0.2)
    print()
    return records


def load_cedula_index() -> dict[str, dict]:
    """Fetch only records that have a cédula — much faster than loading everything."""
    index = {}
    offset = 0
    while True:
        rows = (
            sb.table("missing_persons")
            .select("id,name,cedula")
            .not_.is_("cedula", "null")
            .or_("is_duplicate.eq.false,is_duplicate.is.null")
            .range(offset, offset + 999)
            .execute()
        )
        if not rows.data:
            break
        for r in rows.data:
            if r.get("cedula"):
                index[r["cedula"].strip()] = r
        if len(rows.data) < 1000:
            break
        offset += 1000
    return index


def load_state() -> set[str]:
    if STATE_FILE.exists():
        return set(json.loads(STATE_FILE.read_text()))
    return set()


def save_state(seen_slugs: set[str]):
    STATE_FILE.write_text(json.dumps(sorted(seen_slugs)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--high-only", action="store_true", default=True,
                        help="Demote medium matches to new inserts (default: on)")
    parser.add_argument("--no-high-only", dest="high_only", action="store_false")
    parser.add_argument("--reset", action="store_true",
                        help="Ignore state file and reprocess all records")
    args = parser.parse_args()

    print("[localizados-vzla] Fetching records from API...")
    all_records = fetch_all_records()
    print(f"[localizados-vzla] {len(all_records)} total records fetched")

    seen = set() if args.reset else load_state()
    new_records = [r for r in all_records if r["slug"] not in seen]
    print(f"[localizados-vzla] {len(new_records)} new (unprocessed) records")

    if not new_records:
        print("[localizados-vzla] Nothing new. Done.")
        return

    print("[localizados-vzla] Loading cédula index...")
    cedula_index = load_cedula_index()
    print(f"  {len(cedula_index)} records with cédula in DB")

    cedula_matches = []
    new_inserts = []

    for rec in new_records:
        name = rec["nombreCompleto"].strip()
        cedula = rec.get("cedula", "").strip() or None
        lugar = rec.get("lugarNombre", "desconocido")
        slug = rec["slug"]
        source_url = f"{BASE_URL}/lugares/{rec.get('lugarSlug', slug)}"
        source_label = f"{lugar} via localizadosvenezuela.com"

        if cedula and cedula in cedula_index:
            cedula_matches.append((name, cedula, cedula_index[cedula], source_url, source_label, lugar))
        else:
            new_inserts.append((name, source_url, source_label, lugar))

    print(f"\n=== Results for {len(new_records)} new localizados ===")
    print(f"  🟢 Cédula exacta (updates existing):  {len(cedula_matches)}")
    print(f"  ⚫️  New insert  (name-only, no update): {len(new_inserts)}")
    print("\n  Note: name-only matches are inserted as new records.")
    print("  Cédula is the only signal safe enough to update an existing record.")

    if cedula_matches:
        print("\n🟢 Cédula matches:")
        for name, cedula, rec, *_ in cedula_matches:
            print(f"  [{cedula}] '{name}' ↔ '{rec['name']}' (id={rec['id']})")

    if args.dry_run:
        print("\n[dry-run] No changes written.")
        return

    updated = 0
    inserted = 0

    for name, cedula, rec, source_url, source_label, _ in cedula_matches:
        sb.table("missing_persons").update({
            "status": "localizado",
            "external_source": f"SismoVenezuela:cedula via {source_label}",
            "source2_url": source_url,
        }).eq("id", rec["id"]).execute()
        updated += 1
        print(f"  🟢 updated: {rec['name']} (cédula={cedula})")

    for name, source_url, source_label, lugar in new_inserts:
        sb.table("missing_persons").insert({
            "name": name,
            "last_seen_location": lugar,
            "status": "localizado",
            "external_source": f"localizadosvenezuela.com via {lugar}",
            "source2_url": source_url,
        }).execute()
        inserted += 1

    # Mark all fetched slugs as processed (even unmatched — they're now inserted)
    seen.update(r["slug"] for r in new_records)
    save_state(seen)

    print(f"\n[localizados-vzla] Done — {updated} updated, {inserted} inserted. State saved ({len(seen)} slugs).")


if __name__ == "__main__":
    main()
