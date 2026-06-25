"""
Cross-references a hospital patient list against our missing_persons DB.

Usage:
  conda run -n agent python scrapers/match_hospital_list.py \
    --names "Name One,Name Two,Name Three" \
    --hospital "Hospital Domingo Luciani, Caracas" \
    --tweet "https://x.com/user/status/123456" \
    --source-label "Hospital Domingo Luciani"

For each name in the list the script:
  1. Fuzzy-matches against all non-duplicate missing persons
  2. Inserts a new record (status=localizado) if no match is found
  3. Updates the matched record's status and sets:
       - source2_url  → the tweet that published the patient list
       - external_source → "SismoVenezuela via <hospital>"
       BUT preserves source_id (the original platform ID) so we can still
       link back to desaparecidosterremotovenezuela.com / venezulatebusca.com

Thresholds:
  - score >= 0.85  → high confidence, auto-match
  - 0.72 <= score < 0.85 → medium confidence, printed for manual review
  - score < 0.72  → no match, inserts as new localizado record
"""

import os, sys, argparse
from difflib import SequenceMatcher
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

HIGH = 0.85
LOW  = 0.72


def similarity(a: str, b: str) -> float:
    a, b = a.lower().strip(), b.lower().strip()
    seq = SequenceMatcher(None, a, b).ratio()
    # Word-overlap bonus
    wa, wb = set(a.split()), set(b.split())
    overlap = len(wa & wb) / max(len(wa | wb), 1)
    return max(seq, overlap)


def load_missing() -> list[dict]:
    records = []
    offset = 0
    while True:
        rows = (
            sb.table("missing_persons")
            .select("id,name,external_source,source_id,status")
            .or_("is_duplicate.eq.false,is_duplicate.is.null")
            .range(offset, offset + 999)
            .execute()
        )
        if not rows.data:
            break
        records.extend(rows.data)
        if len(rows.data) < 1000:
            break
        offset += 1000
    return records


def run(names: list[str], hospital: str, tweet_url: str, source_label: str, dry_run: bool = False):
    print(f"\nLoading missing persons DB...")
    missing = load_missing()
    print(f"  {len(missing)} records loaded")

    ext_source = f"SismoVenezuela via {source_label}"
    results = {"high": [], "medium": [], "no_match": []}

    for name in names:
        name = name.strip()
        if not name:
            continue

        best_score = 0.0
        best_rec = None
        for rec in missing:
            s = similarity(name, rec["name"])
            if s > best_score:
                best_score = s
                best_rec = rec

        if best_score >= HIGH:
            results["high"].append((name, best_score, best_rec))
        elif best_score >= LOW:
            results["medium"].append((name, best_score, best_rec))
        else:
            results["no_match"].append(name)

    print(f"\n=== Results for {len(names)} names from {source_label} ===")
    print(f"  High confidence (≥{HIGH}):    {len(results['high'])}")
    print(f"  Medium confidence ({LOW}–{HIGH}): {len(results['medium'])}")
    print(f"  No match (<{LOW}):              {len(results['no_match'])}")

    if results["medium"]:
        print("\n⚠️  Medium confidence — review before accepting:")
        for name, score, rec in results["medium"]:
            print(f"  [{score:.2f}] '{name}' ↔ '{rec['name']}' (id={rec['id']}, src={rec['external_source']})")

    if dry_run:
        print("\n[dry-run] No changes written.")
        return

    updated = 0
    inserted = 0

    for name, score, rec in results["high"] + results["medium"]:
        # Update existing record — preserve source_id (original platform link)
        sb.table("missing_persons").update({
            "status": "localizado",
            "external_source": ext_source,
            "source2_url": tweet_url,
            # source_id is NOT overwritten — it keeps the original platform reference
        }).eq("id", rec["id"]).execute()
        updated += 1
        print(f"  ✓ updated: {rec['name']} (score={score:.2f})")

    for name in results["no_match"]:
        # Insert new localizado record with hospital as source
        sb.table("missing_persons").insert({
            "name": name,
            "last_seen_location": hospital,
            "status": "localizado",
            "external_source": ext_source,
            "source2_url": tweet_url,
        }).execute()
        inserted += 1
        print(f"  + inserted new localizado: {name}")

    print(f"\nDone — {updated} updated, {inserted} inserted.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--names", required=True, help="Comma-separated list of patient names")
    parser.add_argument("--hospital", required=True, help="Hospital name + city (stored as last_seen_location for new records)")
    parser.add_argument("--tweet", required=True, help="URL of the tweet that published this patient list")
    parser.add_argument("--source-label", required=True, help="Short hospital label for external_source field")
    parser.add_argument("--dry-run", action="store_true", help="Print matches without writing to DB")
    args = parser.parse_args()

    names = [n.strip() for n in args.names.split(",") if n.strip()]
    run(names, args.hospital, args.tweet, args.source_label, dry_run=args.dry_run)
