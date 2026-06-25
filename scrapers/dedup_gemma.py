"""
Background deduplication using Gemma (ollama) for missing persons.

Compares records from desaparecidosterremotovenezuela.com vs venezuelatebusca.com
to find the same person listed in both sources.

Algorithm:
  1. Load all non-duplicate records from both external sources
  2. Block by first 4 chars of first name + first char of last name
     → reduces 48M pairs to ~50K comparisons
  3. SequenceMatcher filter >= 0.72 to identify candidates
  4. Auto-match pairs >= 0.92 (no LLM needed)
  5. For 0.72–0.92 range: ask Gemma to confirm (local, no API cost)
  6. Mark the less-complete record as is_duplicate=True in DB

State: ~/agent/logs/dedup_gemma_state.json  (tracks last_run timestamp)

Usage:
  conda run -n agent python scrapers/dedup_gemma.py            # incremental (new records only)
  conda run -n agent python scrapers/dedup_gemma.py --all      # full re-check
  conda run -n agent python scrapers/dedup_gemma.py --dry-run  # print only, no DB writes
"""

import os, sys, io, json, requests, unicodedata, time
from difflib import SequenceMatcher
from datetime import datetime, timezone
from dotenv import load_dotenv
from supabase import create_client

# Force line-buffered stdout so tee / log files get output immediately
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, line_buffering=True)

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "gemma3:4b"
STATE_FILE = os.path.expanduser("~/agent/logs/dedup_gemma_state.json")
PAGE = 1000
AUTO_MATCH_SIM = 0.92   # >= this → auto-match, no LLM
GEMMA_SIM = 0.72        # >= this (and < auto) → ask Gemma
DRY_RUN = "--dry-run" in sys.argv
RECHECK_ALL = "--all" in sys.argv


# ── helpers ─────────────────────────────────────────────────────────────────

def normalize(name: str) -> str:
    nfkd = unicodedata.normalize("NFKD", (name or "").lower().strip())
    ascii_str = "".join(c for c in nfkd if not unicodedata.combining(c))
    return " ".join(ascii_str.split())


def block_key(norm: str) -> str:
    """first 4 chars of first name + '_' + first char of second name."""
    parts = norm.split()
    if not parts:
        return ""
    key = parts[0][:4]
    if len(parts) > 1:
        key += "_" + parts[1][:1]
    return key


def extract_phones(contact_info: str | None) -> set[str]:
    """Extract and normalize phone numbers from a contact_info string."""
    import re
    if not contact_info:
        return set()
    phones = set()
    for m in re.finditer(r"\d{7,15}", re.sub(r"[\s\-\.]", "", contact_info)):
        n = m.group()
        # Strip Venezuelan country code (58) or leading 0
        if n.startswith("58") and len(n) >= 11:
            n = n[2:]
        elif n.startswith("0") and len(n) >= 8:
            n = n[1:]
        if len(n) >= 7:
            phones.add(n)
    return phones


def sim(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def quality(r: dict) -> int:
    """Record completeness score — higher = more complete, keep this one."""
    s = 0
    if r.get("photo_url"):          s += 3
    if r.get("description"):        s += 2
    if r.get("age"):                s += 1
    if r.get("last_seen_location"): s += 1
    return s


# ── state ───────────────────────────────────────────────────────────────────

def load_state() -> dict:
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(state: dict):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


# ── DB helpers ───────────────────────────────────────────────────────────────

def load_records(source: str, since: str | None = None) -> list[dict]:
    """Load non-duplicate records for a given external_source."""
    records = []
    offset = 0
    while True:
        q = (
            sb.table("missing_persons")
            .select("id,name,age,last_seen_location,description,contact_info,external_source,normalized_name,photo_url,submitted_at")
            .eq("external_source", source)
            .or_("is_duplicate.eq.false,is_duplicate.is.null")
        )
        if since:
            q = q.gt("submitted_at", since)
        rows = q.order("submitted_at", desc=False).range(offset, offset + PAGE - 1).execute()
        if not rows.data:
            break
        records.extend(rows.data)
        if len(rows.data) < PAGE:
            break
        offset += PAGE
    return records


def mark_duplicate(dup_id: str, primary_id: str):
    if DRY_RUN:
        return
    try:
        sb.table("missing_persons").update({
            "is_duplicate": True,
            "source2_id": primary_id,
        }).eq("id", dup_id).execute()
    except Exception as e:
        print(f"    DB error marking {dup_id}: {e}")


# ── Gemma ────────────────────────────────────────────────────────────────────

def check_ollama() -> bool:
    try:
        r = requests.get("http://localhost:11434/api/tags", timeout=5)
        return r.status_code == 200
    except Exception:
        return False


def fmt_record(r: dict) -> str:
    parts = [r["name"]]
    if r.get("age"):                parts.append(f"{r['age']} años")
    if r.get("last_seen_location"): parts.append(f"visto en {r['last_seen_location']}")
    if r.get("description"):        parts.append(r["description"][:150])
    return ", ".join(parts)


def ask_gemma(a: dict, b: dict) -> bool:
    prompt = (
        "¿Son estas dos personas la misma persona desaparecida? "
        "Responde únicamente SÍ o NO.\n\n"
        f"Persona A: {fmt_record(a)}\n"
        f"Persona B: {fmt_record(b)}"
    )
    try:
        resp = requests.post(
            OLLAMA_URL,
            json={
                "model": MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.0, "num_predict": 5},
            },
            timeout=30,
        )
        resp.raise_for_status()
        answer = resp.json().get("response", "").strip().upper()
        return answer.startswith("SÍ") or answer.startswith("SI") or answer.startswith("YES")
    except Exception as e:
        print(f"    Gemma error: {e}")
        return False


# ── main ─────────────────────────────────────────────────────────────────────

def run():
    print(f"[{datetime.now(timezone.utc).isoformat()}] Gemma dedup {'(DRY RUN)' if DRY_RUN else ''}")

    if not check_ollama():
        print("  ollama not running — start with: ollama serve")
        sys.exit(1)

    state = load_state()
    last_run = None if RECHECK_ALL else state.get("last_run")

    if last_run:
        print(f"  Incremental — checking records newer than {last_run}")
    else:
        print("  Full check — all records")

    # Load full populations (needed to build blocking index for both sides)
    print("  Loading records...")
    all_desap = load_records("desaparecidos-vzla")
    all_vtb   = load_records("venezulatebusca")
    print(f"  desaparecidos-vzla: {len(all_desap)}  |  venezulatebusca: {len(all_vtb)}")

    # Load just the new records on each side (these are the "queries")
    new_desap = load_records("desaparecidos-vzla", since=last_run) if last_run else all_desap
    new_vtb   = load_records("venezulatebusca",   since=last_run) if last_run else all_vtb
    print(f"  New since last run — desaparecidos: {len(new_desap)}, venezulatebusca: {len(new_vtb)}")

    if not new_desap and not new_vtb:
        print("  Nothing new. Done.")
        save_state({**state, "last_run": datetime.now(timezone.utc).isoformat()})
        return

    # ── Pass 0: phone-number exact match (highest confidence, no Gemma needed) ──
    # Build phone → record maps for each full population
    phone_confirmed = 0
    phone_matched_ids: set[str] = set()  # IDs already resolved via phone match

    def build_phone_index(records: list[dict]) -> dict[str, list[dict]]:
        idx: dict[str, list[dict]] = {}
        for r in records:
            for ph in extract_phones(r.get("contact_info")):
                idx.setdefault(ph, []).append(r)
        return idx

    desap_phone_idx = build_phone_index(all_desap)
    vtb_phone_idx   = build_phone_index(all_vtb)

    # Cross-match phones found in new records
    def phone_pass(new_records: list[dict], opp_phone_idx: dict, new_is_vtb: bool):
        nonlocal phone_confirmed
        for r in new_records:
            phones = extract_phones(r.get("contact_info"))
            for ph in phones:
                for other in opp_phone_idx.get(ph, []):
                    vtb_r, desap_r = (r, other) if new_is_vtb else (other, r)
                    pair_key = f"{vtb_r['id']}:{desap_r['id']}"
                    if vtb_r["id"] in phone_matched_ids or desap_r["id"] in phone_matched_ids:
                        continue
                    print(
                        f"  [PHONE] ✓ MISMO  «{vtb_r['name']}» ↔ «{desap_r['name']}»  "
                        f"(tel: {ph})"
                    )
                    primary, dup = (desap_r, vtb_r) if quality(desap_r) >= quality(vtb_r) else (vtb_r, desap_r)
                    mark_duplicate(dup["id"], primary["id"])
                    phone_matched_ids.add(dup["id"])
                    phone_confirmed += 1

    print("\n  Pass 0 — phone number matching...")
    phone_pass(new_vtb,   desap_phone_idx, new_is_vtb=True)
    phone_pass(new_desap, vtb_phone_idx,   new_is_vtb=False)
    print(f"  Phone matches: {phone_confirmed}")

    # ── Normalize names for passes 1+2 ──
    def with_norm(records: list[dict]) -> list[dict]:
        for r in records:
            r["_norm"] = r.get("normalized_name") or normalize(r["name"])
        return records

    all_desap  = with_norm(all_desap)
    all_vtb    = with_norm(all_vtb)
    new_desap  = with_norm(new_desap)
    new_vtb    = with_norm(new_vtb)

    # Build blocking indexes for full populations
    def build_index(records: list[dict]) -> dict[str, list[dict]]:
        idx: dict[str, list[dict]] = {}
        for r in records:
            k = block_key(r["_norm"])
            idx.setdefault(k, []).append(r)
        return idx

    desap_idx = build_index(all_desap)
    vtb_idx   = build_index(all_vtb)

    # Find candidate pairs (new records vs full opposite population)
    # Skip any record already resolved by phone match
    seen: set[tuple[str, str]] = set()
    candidates: list[tuple[dict, dict, float]] = []  # (vtb_r, desap_r, similarity)

    def find_candidates(new_records: list[dict], opp_index: dict, new_is_vtb: bool):
        for r in new_records:
            if r["id"] in phone_matched_ids:
                continue
            k = block_key(r["_norm"])
            for other in opp_index.get(k, []):
                if other["id"] in phone_matched_ids:
                    continue
                vtb_r, desap_r = (r, other) if new_is_vtb else (other, r)
                pair = (vtb_r["id"], desap_r["id"])
                if pair in seen:
                    continue
                seen.add(pair)
                s = sim(r["_norm"], other["_norm"])
                if s >= GEMMA_SIM:
                    candidates.append((vtb_r, desap_r, s))

    find_candidates(new_vtb,   desap_idx, new_is_vtb=True)
    find_candidates(new_desap, vtb_idx,   new_is_vtb=False)

    candidates.sort(key=lambda x: x[2], reverse=True)
    auto   = sum(1 for _, _, s in candidates if s >= AUTO_MATCH_SIM)
    gemma  = len(candidates) - auto
    print(f"\n  Candidates: {len(candidates)}  (auto-match: {auto}, Gemma: {gemma})")
    if gemma > 0:
        print(f"  Estimated Gemma time: ~{gemma * 2 // 60}m {gemma * 2 % 60}s")

    if not candidates:
        print("  No candidates. Done.")
        save_state({**state, "last_run": datetime.now(timezone.utc).isoformat()})
        return

    # ── evaluate each pair ──
    print()
    confirmed = 0
    for i, (vtb_r, desap_r, s) in enumerate(candidates):
        if s >= AUTO_MATCH_SIM:
            is_same = True
            method = "AUTO"
        else:
            is_same = ask_gemma(vtb_r, desap_r)
            method = "Gemma"
            time.sleep(0.05)   # don't hammer ollama

        verdict = "✓ MISMO" if is_same else "  distinto"
        print(
            f"  [{i+1:4d}/{len(candidates)}] {method:5s} {s:.2f}  "
            f"{verdict}  «{vtb_r['name']}» ↔ «{desap_r['name']}»"
        )

        if is_same:
            # Keep the record with more data; mark the other as duplicate
            primary, dup = (desap_r, vtb_r) if quality(desap_r) >= quality(vtb_r) else (vtb_r, desap_r)
            mark_duplicate(dup["id"], primary["id"])
            confirmed += 1

    total = phone_confirmed + confirmed
    print(f"\n  ── Result: {total} total duplicates marked"
          f"  (phone: {phone_confirmed}, name/Gemma: {confirmed}/{len(candidates)})"
          + (" — DRY RUN, no DB writes" if DRY_RUN else ""))

    if not DRY_RUN:
        save_state({**state, "last_run": datetime.now(timezone.utc).isoformat()})
        print(f"  State saved → {STATE_FILE}")


if __name__ == "__main__":
    run()
