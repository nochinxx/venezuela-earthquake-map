#!/usr/bin/env python3
"""
centrosayuda_scraper.py — Scrape centrosayudavenezuela.org for Venezuelan relief centers.

Extracts name, address, city, accepted items, and coordinates (from embedded Google Maps links).
Filters to Venezuela only (skips international entries). Deduplicates by address.

Run: conda run -n agent python scrapers/centrosayuda_scraper.py
"""
import os, re, sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

import requests
from bs4 import BeautifulSoup
from supabase import create_client

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

SOURCE_URL = "https://centrosayudavenezuela.org/"
SOURCE_NAME = "centrosayudavenezuela.org"

# City → Venezuelan state mapping
CITY_STATE = {
    "caracas":          "Distrito Capital",
    "la guaira":        "La Guaira",
    "vargas":           "La Guaira",
    "maiquetía":        "La Guaira",
    "maiquetia":        "La Guaira",
    "valencia":         "Carabobo",
    "carabobo":         "Carabobo",
    "maracay":          "Aragua",
    "aragua":           "Aragua",
    "la victoria":      "Aragua",
    "turmero":          "Aragua",
    "barquisimeto":     "Lara",
    "lara":             "Lara",
    "maracaibo":        "Zulia",
    "zulia":            "Zulia",
    "cabimas":          "Zulia",
    "mérida":           "Mérida",
    "merida":           "Mérida",
    "san cristóbal":    "Táchira",
    "san cristobal":    "Táchira",
    "táchira":          "Táchira",
    "tachira":          "Táchira",
    "barinas":          "Barinas",
    "maturín":          "Monagas",
    "maturin":          "Monagas",
    "cumaná":           "Sucre",
    "cumana":           "Sucre",
    "carúpano":         "Sucre",
    "carupano":         "Sucre",
    "sucre":            "Sucre",
    "barcelona":        "Anzoátegui",
    "puerto la cruz":   "Anzoátegui",
    "el tigre":         "Anzoátegui",
    "anzoátegui":       "Anzoátegui",
    "anzoategui":       "Anzoátegui",
    "puerto ordaz":     "Bolívar",
    "ciudad guayana":   "Bolívar",
    "ciudad bolívar":   "Bolívar",
    "ciudad bolivar":   "Bolívar",
    "upata":            "Bolívar",
    "bolívar":          "Bolívar",
    "bolivar":          "Bolívar",
    "san felipe":       "Yaracuy",
    "yaracuy":          "Yaracuy",
    "guanare":          "Portuguesa",
    "portuguesa":       "Portuguesa",
    "acarigua":         "Portuguesa",
    "coro":             "Falcón",
    "falcon":           "Falcón",
    "falcón":           "Falcón",
    "punto fijo":       "Falcón",
    "los teques":       "Miranda",
    "guarenas":         "Miranda",
    "guatire":          "Miranda",
    "petare":           "Miranda",
    "miranda":          "Miranda",
    "porlamar":         "Nueva Esparta",
    "nueva esparta":    "Nueva Esparta",
    "tucupita":         "Delta Amacuro",
    "san fernando":     "Apure",
    "apure":            "Apure",
    "ciudad bolívar":   "Bolívar",
    "calabozo":         "Guárico",
    "guárico":          "Guárico",
    "guarico":          "Guárico",
    "valera":           "Trujillo",
    "trujillo":         "Trujillo",
    "trujillo":         "Trujillo",
}


def parse_coords(maps_url: str) -> tuple[float | None, float | None]:
    """Extract lat, lng from a Google Maps URL like ?q=10.123%2C%20-66.456"""
    m = re.search(r"[?&]q=([-\d.]+)[,%20 ]+([-\d.]+)", maps_url)
    if m:
        return float(m.group(1)), float(m.group(2))
    return None, None


def infer_state(city: str) -> str:
    city_lower = city.lower().strip()
    for key, state in CITY_STATE.items():
        if key in city_lower:
            return state
    return "Venezuela"


def scrape() -> None:
    print(f"[centrosayuda] Fetching {SOURCE_URL}...")
    resp = requests.get(SOURCE_URL, timeout=20, headers={"User-Agent": "SismoVenezuela/1.0"})
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    cards = soup.select("div.center-card")
    print(f"[centrosayuda] Found {len(cards)} cards total")

    inserted = skipped = errors = 0

    for card in cards:
        city_el = card.select_one(".city, span.city")
        city_raw = city_el.get_text(strip=True) if city_el else ""

        # Skip international entries — they have "· Country" in the city field
        if "·" in city_raw:
            continue

        name_el = card.select_one("h2")
        address_el = card.select_one("p.address, .address")
        items_el = card.select_one("p.items-list, .items-list")
        map_link = card.select_one("a.map-link, a[href*='maps.google'], a[href*='google.com/maps']")

        name = name_el.get_text(strip=True) if name_el else ""
        address = address_el.get_text(strip=True) if address_el else ""
        accepted_items = items_el.get_text(strip=True) if items_el else ""

        if not name or not address:
            continue

        lat, lng = None, None
        if map_link:
            lat, lng = parse_coords(map_link.get("href", ""))

        state = infer_state(city_raw)

        # Dedup by address
        existing = sb.table("relief_centers").select("id").eq("address", address).execute().data
        if existing:
            skipped += 1
            continue

        try:
            sb.table("relief_centers").insert({
                "name": name,
                "address": address,
                "state": state,
                "lat": lat,
                "lng": lng,
                "source_name": SOURCE_NAME,
                "source_url": SOURCE_URL,
                "accepted_items": accepted_items,
            }).execute()
            print(f"  + {name} ({city_raw})")
            inserted += 1
        except Exception as e:
            print(f"  [error] {name}: {e}")
            errors += 1

    print(f"[centrosayuda] Done — {inserted} inserted, {skipped} already in DB, {errors} errors")


if __name__ == "__main__":
    scrape()
