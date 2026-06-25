"""
Scraper for venezuela-ayuda.com/solicitudes — active aid requests.
Runs every 30 min. Sets expires_at = now + 6h on each upsert.

BEFORE FIRST RUN — paste this SQL in Supabase Dashboard > SQL Editor:

  CREATE TABLE IF NOT EXISTS needs_requests (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title         text NOT NULL,
    description   text,
    category      text DEFAULT 'otro',
    priority      text DEFAULT 'urgente',
    lat           double precision,
    lng           double precision,
    location_name text,
    contact_info  text,
    items_needed  text,
    source_url    text,
    external_id   text,
    external_source text,
    submitted_by  text,
    created_at    timestamptz DEFAULT now(),
    expires_at    timestamptz,
    is_active     boolean DEFAULT true,
    UNIQUE(external_source, external_id)
  );
  CREATE INDEX IF NOT EXISTS needs_location_idx ON needs_requests(lat, lng);
  CREATE INDEX IF NOT EXISTS needs_active_idx ON needs_requests(is_active, expires_at);
  ALTER TABLE needs_requests ENABLE ROW LEVEL SECURITY;
  CREATE POLICY public_read_needs ON needs_requests FOR SELECT USING (true);
  CREATE POLICY service_role_write_needs ON needs_requests FOR ALL USING (auth.role() = 'service_role');
"""

import os, re, time, requests as req
from datetime import datetime, timezone, timedelta
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

BASE = "https://venezuela-ayuda.com"
TTL_HOURS = 6

CATEGORY_MAP = {
    "rescate":      "rescate",
    "rescue":       "rescate",
    "electricidad": "electricidad",
    "electric":     "electricidad",
    "alimento":     "alimentos",
    "comida":       "alimentos",
    "agua":         "alimentos",
    "voluntario":   "voluntarios",
    "herramienta":  "herramientas",
    "material":     "materiales",
    "medicamento":  "medicamentos",
    "salud":        "medicamentos",
    "medico":       "medicamentos",
}

LOCATIONS: dict[str, tuple[float, float]] = {
    "la guaira":       (10.6017, -66.9340),
    "catia la mar":    (10.5978, -67.0242),
    "caraballeda":     (10.6213, -66.8590),
    "macuto":          (10.6109, -66.8843),
    "naiguatá":        (10.6277, -66.7495),
    "naiguata":        (10.6277, -66.7495),
    "playa grande":    (10.5990, -67.0050),
    "maiquetía":       (10.5975, -66.9600),
    "maiquetia":       (10.5975, -66.9600),
    "carayaca":        (10.5541, -67.1066),
    "caracas":         (10.4806, -66.9036),
    "petare":          (10.4805, -66.7832),
    "chacao":          (10.4942, -66.8516),
    "altamira":        (10.4955, -66.8474),
    "valencia":        (10.1620, -67.9903),
    "maracaibo":       (10.6316, -71.6428),
    "barquisimeto":    (10.0647, -69.3571),
    "maracay":         (10.2469, -67.5958),
    "mérida":          (8.5916,  -71.1440),
    "merida":          (8.5916,  -71.1440),
    "cumaná":          (10.4574, -64.1744),
    "cumana":          (10.4574, -64.1744),
    "la mora":         (10.1700, -68.0000),
    "tocuyito":        (10.0800, -68.0600),
    "catia":           (10.4900, -67.0000),
    "vargas":          (10.6017, -66.9340),
    "litoral":         (10.6017, -66.9340),
    "los teques":      (10.3445, -67.0398),
}


def infer_category(text: str) -> str:
    t = text.lower()
    for kw, cat in CATEGORY_MAP.items():
        if kw in t:
            return cat
    return "otro"


def geocode(location: str) -> tuple[float | None, float | None]:
    if not location:
        return None, None
    loc = location.lower().strip()
    for key, coords in LOCATIONS.items():
        if key in loc:
            return coords
    return None, None


def scrape_list() -> list[str]:
    """Return list of solicitud UUIDs from the listing page."""
    try:
        r = req.get(f"{BASE}/solicitudes", timeout=15, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
    except Exception as e:
        print(f"[needs] list fetch failed: {e}")
        return []
    soup = BeautifulSoup(r.text, "html.parser")
    uuids = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        m = re.search(r"/solicitud/([0-9a-f-]{36})", href)
        if m:
            uid = m.group(1)
            if uid not in uuids:
                uuids.append(uid)
    print(f"[needs] found {len(uuids)} solicitudes")
    return uuids


def scrape_detail(uid: str) -> dict | None:
    """Scrape an individual solicitud page and return a structured dict."""
    url = f"{BASE}/solicitud/{uid}"
    try:
        r = req.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
    except Exception as e:
        print(f"[needs] {uid} fetch failed: {e}")
        return None

    soup = BeautifulSoup(r.text, "html.parser")
    text = soup.get_text(separator=" ", strip=True)

    # Title: first h1 or h2 — strip boilerplate suffix
    title_el = soup.find(["h1", "h2"])
    raw_title = title_el.get_text(strip=True) if title_el else "Solicitud de ayuda"
    # Cut at known boilerplate markers
    for cut in ["Actualizado", "Comparte", "¿Puedes", "Fuente:", " | ", "\n"]:
        raw_title = raw_title.split(cut)[0]
    title = raw_title.strip()[:200] or "Solicitud de ayuda"

    # Location: look for 📍 marker — take only first 60 chars before boilerplate
    loc_match = re.search(r"📍\s*(.+?)(?:\s+Actualizado|\s+Comparte|\s+🌐|\s*$)", text[:500])
    raw_loc = loc_match.group(1).strip() if loc_match else ""
    location_name = raw_loc[:80] if raw_loc else ""

    # Category from emoji or keyword
    category_raw = ""
    for emoji, cat in [("🚨", "rescate"), ("⚡", "electricidad"), ("🍞", "alimentos"),
                       ("💧", "alimentos"), ("👥", "voluntarios"), ("🔧", "herramientas"),
                       ("🏗", "materiales"), ("💊", "medicamentos")]:
        if emoji in text:
            category_raw = cat
            break
    if not category_raw:
        category_raw = infer_category(text)

    # Priority
    priority = "urgente"
    if "crítico" in text.lower() or "critico" in text.lower():
        priority = "critico"
    elif "importante" in text.lower():
        priority = "importante"

    # Description: longest paragraph-ish chunk under 500 chars
    paragraphs = [p.get_text(strip=True) for p in soup.find_all("p") if len(p.get_text(strip=True)) > 30]
    description = paragraphs[0] if paragraphs else text[:300]

    # Items needed: look for list items
    items = [li.get_text(strip=True) for li in soup.find_all("li") if li.get_text(strip=True)]
    items_str = ", ".join(items[:10]) if items else None

    # Contact: phone number
    phone_match = re.search(r"(?:04\d{2}|0212|58)\s*[\d\s\-]{7,}", text)
    contact = phone_match.group(0).strip() if phone_match else None

    lat, lng = geocode(location_name or title)

    now = datetime.now(timezone.utc)
    return {
        "external_id": uid,
        "external_source": "venezuela-ayuda.com",
        "source_url": url,
        "title": title[:200],
        "description": description[:500],
        "category": category_raw,
        "priority": priority,
        "location_name": location_name or None,
        "lat": lat,
        "lng": lng,
        "items_needed": items_str,
        "contact_info": contact,
        "expires_at": (now + timedelta(hours=TTL_HOURS)).isoformat(),
        "is_active": True,
    }


def run():
    uuids = scrape_list()
    if not uuids:
        return

    inserted = 0
    updated = 0
    for uid in uuids:
        record = scrape_detail(uid)
        if not record:
            continue
        res = sb.table("needs_requests").upsert(
            record,
            on_conflict="external_source,external_id"
        ).execute()
        if res.data:
            inserted += 1
        time.sleep(0.4)

    print(f"[needs] done — {inserted} upserted from {len(uuids)} solicitudes")

    # Expire old records not seen this run
    cutoff = datetime.now(timezone.utc).isoformat()
    sb.table("needs_requests") \
        .update({"is_active": False}) \
        .eq("external_source", "venezuela-ayuda.com") \
        .lt("expires_at", cutoff) \
        .execute()


if __name__ == "__main__":
    run()
