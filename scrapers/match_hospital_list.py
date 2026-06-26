"""
Cross-references a hospital patient list against our missing_persons DB.

Usage:
  conda run -n agent python scrapers/match_hospital_list.py \
    --names "Name One|CI1,Name Two,Name Three|CI3" \
    --hospital "Hospital Pérez Carreño, Caracas" \
    --tweet "https://x.com/user/status/123456" \
    --source-label "Hospital Pérez Carreño"

Name format: "Apellido Nombre|cédula" — the |cédula part is optional.
If a cédula is provided and matches exactly in the DB → 🟢 (cedula confidence, best tier).
Otherwise falls back to fuzzy name matching.

Confidence tiers (stored in external_source):
  SismoVenezuela:cedula via <label>   → 🟢 exact cédula match
  SismoVenezuela:high via <label>     → 🟡 name similarity ≥ 0.85
  SismoVenezuela:medium via <label>   → 🟠 name similarity 0.72–0.84
  SismoVenezuela via <label>          → ⚫️ new insert, no prior DB record

Thresholds:
  - cedula exact match → green, auto-update
  - score >= 0.85  → high confidence, auto-match
  - 0.72 <= score < 0.85 → medium confidence, printed for manual review
  - score < 0.72  → no match, inserts as new localizado record
"""

import os, sys, argparse
from dotenv import load_dotenv
from supabase import create_client

try:
    from rapidfuzz import fuzz as _rfuzz, process as _rprocess
    _RAPIDFUZZ = True
except ImportError:
    from difflib import SequenceMatcher
    _RAPIDFUZZ = False

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

HIGH = 0.85
LOW  = 0.72

# Thresholds as 0–100 for rapidfuzz
_HIGH_RF = HIGH * 100
_LOW_RF  = LOW  * 100


def similarity(a: str, b: str) -> float:
    a, b = a.lower().strip(), b.lower().strip()
    if _RAPIDFUZZ:
        seq = _rfuzz.WRatio(a, b) / 100.0
    else:
        from difflib import SequenceMatcher
        seq = SequenceMatcher(None, a, b).ratio()
    wa, wb = set(a.split()), set(b.split())
    overlap = len(wa & wb) / max(len(wa | wb), 1)
    return max(seq, overlap)


def best_match(name: str, missing: list[dict]) -> tuple[float, dict | None]:
    """Return (score, record) for the best match. Uses rapidfuzz batch scan when available."""
    if not missing:
        return 0.0, None
    if _RAPIDFUZZ:
        names = [r["name"] for r in missing]
        result = _rprocess.extractOne(
            name.lower().strip(), names,
            scorer=_rfuzz.WRatio,
            score_cutoff=_LOW_RF * 0.9,  # slightly below LOW to let token-overlap catch edge cases
        )
        if result is None:
            return 0.0, None
        idx = result[2]
        score = similarity(name, missing[idx]["name"])
        return score, missing[idx]
    else:
        best_score, best_rec = 0.0, None
        for rec in missing:
            s = similarity(name, rec["name"])
            if s > best_score:
                best_score, best_rec = s, rec
        return best_score, best_rec


def load_missing() -> tuple[list[dict], dict[str, dict]]:
    """Returns (records list, cedula→record index)."""
    records = []
    cedula_index: dict[str, dict] = {}
    offset = 0
    while True:
        rows = (
            sb.table("missing_persons")
            .select("id,name,external_source,source_id,status,cedula")
            .or_("is_duplicate.eq.false,is_duplicate.is.null")
            .range(offset, offset + 999)
            .execute()
        )
        if not rows.data:
            break
        for r in rows.data:
            records.append(r)
            if r.get("cedula"):
                cedula_index[r["cedula"].strip()] = r
        if len(rows.data) < 1000:
            break
        offset += 1000
    return records, cedula_index


def parse_persons(raw_names: list[str]) -> list[dict]:
    """Parse 'Name|CI' entries into {name, cedula} dicts. CI is optional."""
    persons = []
    for entry in raw_names:
        entry = entry.strip()
        if not entry:
            continue
        if "|" in entry:
            parts = entry.split("|", 1)
            name = parts[0].strip()
            cedula = parts[1].strip() or None
        else:
            name = entry
            cedula = None
        if name:
            persons.append({"name": name, "cedula": cedula})
    return persons


def run(names: list[str], hospital: str, tweet_url: str | None, source_label: str,
        dry_run: bool = False, high_only: bool = False):
    print(f"\nLoading missing persons DB...")
    missing, cedula_index = load_missing()
    print(f"  {len(missing)} records loaded, {len(cedula_index)} with cédula")

    persons = parse_persons(names)
    print(f"  {len(persons)} persons to match ({sum(1 for p in persons if p['cedula'])} with cédula)")

    results: dict[str, list] = {"cedula": [], "high": [], "medium": [], "no_match": []}

    for person in persons:
        name = person["name"]
        cedula = person["cedula"]

        # 1. Exact cédula match — best tier
        if cedula and cedula in cedula_index:
            rec = cedula_index[cedula]
            results["cedula"].append((name, cedula, rec))
            continue

        # 2. Fuzzy name match
        best_score, best_rec = best_match(name, missing)

        if best_score >= HIGH:
            results["high"].append((name, best_score, best_rec))
        elif best_score >= LOW:
            results["medium"].append((name, best_score, best_rec))
        else:
            results["no_match"].append(name)

    total = len(persons)
    print(f"\n=== Results for {total} persons from {source_label} ===")
    print(f"  🟢 Cédula exacta:               {len(results['cedula'])}")
    print(f"  🟡 High confidence (≥{HIGH}):    {len(results['high'])}")
    print(f"  🟠 Medium confidence ({LOW}–{HIGH}): {len(results['medium'])}")
    print(f"  ⚫️  No match (<{LOW}):              {len(results['no_match'])}")

    if results["cedula"]:
        print("\n🟢 Cédula matches:")
        for name, cedula, rec in results["cedula"]:
            print(f"  [{cedula}] '{name}' ↔ '{rec['name']}' (id={rec['id']}, src={rec['external_source']})")

    if results["medium"]:
        print("\n⚠️  Medium confidence — review before accepting:")
        for name, score, rec in results["medium"]:
            print(f"  [{score:.2f}] '{name}' ↔ '{rec['name']}' (id={rec['id']}, src={rec['external_source']})")

    if high_only and results["medium"]:
        print(f"\n[high-only] Skipping {len(results['medium'])} medium-confidence matches → inserting as new:")
        for name, score, rec in results["medium"]:
            print(f"  ✗ skipped: '{name}' ↔ '{rec['name']}' ({score:.2f})")
        results["no_match"].extend(n for n, _, _ in results["medium"])
        results["medium"] = []

    if dry_run:
        print("\n[dry-run] No changes written.")
        return

    updated = 0
    inserted = 0

    # Cédula matches → 🟢
    for name, cedula, rec in results["cedula"]:
        ext_source = f"SismoVenezuela:cedula via {source_label}"
        sb.table("missing_persons").update({
            "status": "localizado",
            "external_source": ext_source,
            "source2_url": tweet_url,
        }).eq("id", rec["id"]).execute()
        updated += 1
        print(f"  🟢 updated: {rec['name']} (cédula={cedula})")

    # Name matches → 🟡/🟠
    for name, score, rec in results["high"] + results["medium"]:
        confidence = "high" if score >= HIGH else "medium"
        ext_source = f"SismoVenezuela:{confidence} via {source_label}"
        sb.table("missing_persons").update({
            "status": "localizado",
            "external_source": ext_source,
            "source2_url": tweet_url,
        }).eq("id", rec["id"]).execute()
        updated += 1
        print(f"  ✓ updated: {rec['name']} (score={score:.2f}, confidence={confidence})")

    # No match → new insert → ⚫️
    for name in results["no_match"]:
        ext_source_new = f"SismoVenezuela via {source_label}"
        sb.table("missing_persons").insert({
            "name": name,
            "last_seen_location": hospital,
            "status": "localizado",
            "external_source": ext_source_new,
            "source2_url": tweet_url,
        }).execute()
        inserted += 1
        print(f"  + inserted new localizado: {name}")

    print(f"\nDone — {updated} updated ({len(results['cedula'])} 🟢 cedula + {len(results['high'])} 🟡 high + {len(results['medium'])} 🟠 medium), {inserted} ⚫️ inserted.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--names", required=True,
                        help="Comma-separated names, optionally with cédula: 'Name|CI,Name2,Name3|CI3'")
    parser.add_argument("--hospital", required=True,
                        help="Hospital name + city (stored as last_seen_location for new records)")
    parser.add_argument("--tweet", required=False, default=None,
                        help="URL of the tweet/source that published this patient list")
    parser.add_argument("--source-label", required=True,
                        help="Short hospital label for external_source field")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print matches without writing to DB")
    parser.add_argument("--high-only", action="store_true",
                        help="Only update high-confidence name matches; insert medium as new records")
    args = parser.parse_args()

    raw = [n.strip() for n in args.names.split(",") if n.strip()]
    run(raw, args.hospital, args.tweet, args.source_label,
        dry_run=args.dry_run, high_only=args.high_only)
