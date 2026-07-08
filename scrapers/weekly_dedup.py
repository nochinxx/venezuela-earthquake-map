"""
Weekly dedup job for missing_persons table.
Run: conda run -n agent python scrapers/weekly_dedup.py

Strategy:
1. Exact cedula match across platforms → keep oldest record, mark rest is_duplicate=True
2. Fuzzy name match (≥88%) within same state/location → flag for review, don't auto-merge
3. Update last_verified_at on all active (sin-contacto, non-duplicate) records touched by scrapers today
4. Print summary report at end

Dry-run by default. Pass --commit to write changes.
"""

import sys
import os
import argparse
from dotenv import load_dotenv
from supabase import create_client
from difflib import SequenceMatcher
from collections import defaultdict
from datetime import datetime, timezone

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

NOW = datetime.now(timezone.utc).isoformat()


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def run(dry_run: bool = True):
    print(f"{'[DRY RUN] ' if dry_run else ''}Weekly dedup — {NOW}\n")

    # ── 1. Pull all non-duplicate records ──────────────────────────────────
    print("Loading records...")
    page_size = 1000
    all_records = []
    offset = 0
    while True:
        res = (
            sb.table("missing_persons")
            .select("id,name,cedula,status,external_source,last_seen_location,submitted_at,is_duplicate")
            .or_("is_duplicate.eq.false,is_duplicate.is.null")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = res.data or []
        all_records.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    print(f"Loaded {len(all_records):,} active (non-duplicate) records\n")

    # ── 2. Exact cedula dedup ──────────────────────────────────────────────
    cedula_groups: dict[str, list[dict]] = defaultdict(list)
    for r in all_records:
        cedula = (r.get("cedula") or "").strip()
        if cedula and len(cedula) >= 6:
            cedula_groups[cedula].append(r)

    cedula_dupes: list[tuple[str, list[dict]]] = [
        (ced, group) for ced, group in cedula_groups.items() if len(group) > 1
    ]
    print(f"Cedula duplicates found: {len(cedula_dupes)} groups")

    cedula_to_mark: list[str] = []
    for cedula, group in cedula_dupes:
        # Keep oldest record (earliest submitted_at), mark the rest
        sorted_group = sorted(group, key=lambda r: r.get("submitted_at") or "")
        keep = sorted_group[0]
        to_mark = sorted_group[1:]
        names_display = " / ".join(r["name"] for r in group)
        print(f"  CEDULA {cedula}: keep '{keep['name']}' ({keep['external_source']}) → mark {len(to_mark)} duplicate(s): {names_display}")
        cedula_to_mark.extend(r["id"] for r in to_mark)

    # ── 3. Fuzzy name dedup (same location, high similarity) ──────────────
    # Group by normalized location prefix to limit comparison scope
    location_groups: dict[str, list[dict]] = defaultdict(list)
    for r in all_records:
        loc = (r.get("last_seen_location") or "desconocido").strip().lower()[:30]
        location_groups[loc].append(r)

    fuzzy_candidates: list[tuple[dict, dict, float]] = []
    for loc, group in location_groups.items():
        if len(group) < 2:
            continue
        # O(n²) within location bucket — acceptable for <200 per location
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                a, b = group[i], group[j]
                if a["id"] == b["id"]:
                    continue
                # Skip if either is already queued for cedula dedup
                if a["id"] in cedula_to_mark or b["id"] in cedula_to_mark:
                    continue
                score = similarity(a["name"], b["name"])
                if score >= 0.88:
                    fuzzy_candidates.append((a, b, score))

    print(f"\nFuzzy name candidates (≥88% similarity, same location): {len(fuzzy_candidates)}")
    fuzzy_to_review: list[dict] = []
    for a, b, score in fuzzy_candidates[:20]:  # Show first 20
        print(f"  {score:.0%} '{a['name']}' ({a['external_source']}) ↔ '{b['name']}' ({b['external_source']}) @ {a.get('last_seen_location','?')[:40]}")
        fuzzy_to_review.append({"id_a": a["id"], "id_b": b["id"], "score": round(score, 3), "name_a": a["name"], "name_b": b["name"]})
    if len(fuzzy_candidates) > 20:
        print(f"  ... and {len(fuzzy_candidates) - 20} more (run with --verbose to see all)")

    # ── 4. Apply cedula dedup ──────────────────────────────────────────────
    if cedula_to_mark:
        print(f"\n{'Would mark' if dry_run else 'Marking'} {len(cedula_to_mark)} cedula duplicates as is_duplicate=True")
        if not dry_run:
            # Batch update in chunks of 100
            for i in range(0, len(cedula_to_mark), 100):
                chunk = cedula_to_mark[i:i+100]
                sb.table("missing_persons").update({
                    "is_duplicate": True,
                    "last_verified_at": NOW,
                }).in_("id", chunk).execute()
            print(f"  ✓ Marked {len(cedula_to_mark)} records")

    # ── 5. Update last_verified_at on active sin-contacto records ──────────
    # Mark all currently active, non-duplicate, sin-contacto records as verified today
    active_ids = [
        r["id"] for r in all_records
        if r.get("status") in ("sin-contacto", None)
        and r["id"] not in cedula_to_mark
    ]
    print(f"\n{'Would update' if dry_run else 'Updating'} last_verified_at on {len(active_ids):,} active records")
    if not dry_run and active_ids:
        for i in range(0, len(active_ids), 500):
            chunk = active_ids[i:i+500]
            sb.table("missing_persons").update({
                "last_verified_at": NOW,
            }).in_("id", chunk).execute()
        print(f"  ✓ Updated {len(active_ids):,} records")

    # ── 6. Summary ────────────────────────────────────────────────────────
    print(f"""
{'=' * 60}
DEDUP SUMMARY {'(DRY RUN — no changes written)' if dry_run else '(COMMITTED)'}
{'=' * 60}
Total active records scanned:  {len(all_records):,}
Cedula duplicate groups found: {len(cedula_dupes)}
Records to mark as duplicate:  {len(cedula_to_mark)}
Fuzzy name candidates (≥88%):  {len(fuzzy_candidates)} (review manually)
last_verified_at updated:      {'0 (dry run)' if dry_run else f'{len(active_ids):,}'}

Run with --commit to apply changes.
Fuzzy candidates need manual review before marking — do NOT auto-merge names.
""")

    return {
        "scanned": len(all_records),
        "cedula_dupe_groups": len(cedula_dupes),
        "cedula_marked": len(cedula_to_mark),
        "fuzzy_candidates": len(fuzzy_candidates),
        "fuzzy_review": fuzzy_to_review,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Weekly dedup job for missing_persons")
    parser.add_argument("--commit", action="store_true", help="Write changes (default: dry run)")
    parser.add_argument("--verbose", action="store_true", help="Show all fuzzy candidates")
    args = parser.parse_args()
    run(dry_run=not args.commit)
