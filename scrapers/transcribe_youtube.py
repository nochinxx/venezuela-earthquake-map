#!/usr/bin/env python3
"""
transcribe_youtube.py — Download auto-subs from YouTube reports, extract locations via
keyword match then Gemma fallback. Updates Supabase with better lat/lng/location_name.

Run: conda run -n agent python scrapers/transcribe_youtube.py
"""
import os, re, subprocess, tempfile
from pathlib import Path
from dotenv import load_dotenv
import whisper as _whisper

_whisper_model = None

def get_whisper():
    global _whisper_model
    if _whisper_model is None:
        _whisper_model = _whisper.load_model("base")
    return _whisper_model

load_dotenv(dotenv_path=Path(__file__).parent / ".env")

from supabase import create_client

sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

YT_DLP = "/opt/homebrew/Caskroom/miniforge/base/envs/agent/bin/yt-dlp"

LOCATIONS = {
    "caracas": (10.4806, -66.9036),
    "valencia": (10.1620, -67.9903),
    "carabobo": (10.1620, -67.9903),
    "maracaibo": (10.6316, -71.6428),
    "barquisimeto": (10.0647, -69.3571),
    "maracay": (10.2469, -67.5958),
    "aragua": (10.2603, -67.5894),
    "miranda": (10.3000, -66.6000),
    "yumare": (10.6383, -68.6847),
    "san felipe": (10.3394, -68.7453),
    "yaracuy": (10.3394, -68.7453),
    "falcon": (11.2000, -69.7000),
    "falcón": (11.2000, -69.7000),
    "lara": (10.0647, -69.3571),
    "maturin": (9.7450, -63.1800),
    "cumana": (10.4574, -64.1744),
    "merida": (8.5916, -71.1440),
    "mérida": (8.5916, -71.1440),
    "san cristobal": (7.7653, -72.2254),
    "tachira": (7.7653, -72.2254),
    "táchira": (7.7653, -72.2254),
    "ciudad bolivar": (8.1222, -63.5497),
    "bolivar estado": (8.1222, -63.5497),
    "petare": (10.4800, -66.8000),
    "guarenas": (10.4667, -66.5333),
    "guatire": (10.4750, -66.5333),
    "la guaira": (10.6013, -66.9337),
    "vargas": (10.6000, -67.1000),
    "los teques": (10.3372, -67.0400),
    "portuguesa": (9.0940, -69.4420),
    "cojedes": (9.4084, -68.3312),
    "barinas": (8.6275, -70.2076),
    "trujillo": (9.3560, -70.4296),
    "apure": (7.0803, -69.5388),
    "amazonas": (3.9897, -67.0228),
    "delta amacuro": (8.5997, -61.0253),
    "anzoategui": (10.1333, -64.6833),
    "monagas": (9.7450, -63.1800),
    "sucre estado": (10.4574, -64.1744),
    "zulia": (10.6316, -71.6428),
    "puerto la cruz": (10.2131, -64.6347),
    "barcelona": (10.1333, -64.6833),
}

# These are too generic — keyword match only, don't override with these from Gemma
GENERIC = {"venezuela", "caracas"}


def strip_vtt(text: str) -> str:
    text = re.sub(r"WEBVTT.*?\n\n", "", text, flags=re.DOTALL)
    text = re.sub(r"\d{2}:\d{2}:\d{2}\.\d+ --> .*\n", "", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"^\s*\d+\s*$", "", text, flags=re.MULTILINE)
    return re.sub(r"\n{2,}", "\n", text).strip()


def keyword_location(text: str):
    t = text.lower()
    # Prefer specific cities over states
    for place, coords in LOCATIONS.items():
        if place in GENERIC:
            continue
        if place in t:
            return place.title(), coords[0], coords[1]
    return None, None, None


def gemma_location(text: str):
    snippet = text[:1500]
    prompt = (
        "Eres un asistente que extrae ubicaciones de Venezuela.\n"
        "Del siguiente texto, extrae UNA ciudad o estado venezolano específico mencionado.\n"
        "Responde SOLO con el nombre del lugar en español. Si no hay ninguno, responde: NINGUNO\n\n"
        f"Texto: {snippet}"
    )
    try:
        r = subprocess.run(
            ["conda", "run", "-n", "agent", "ollama", "run", "gemma3:4b"],
            input=prompt, capture_output=True, text=True, timeout=30,
        )
        reply = r.stdout.strip().lower()
        if not reply or reply in ("ninguno", "none", "no hay"):
            return None, None, None
        for place, coords in LOCATIONS.items():
            if place in reply or reply in place:
                return place.title(), coords[0], coords[1]
    except Exception as e:
        print(f"    [gemma error] {e}")
    return None, None, None


def get_subtitles(url: str, tmpdir: str) -> str | None:
    subprocess.run(
        [
            YT_DLP, url,
            "--write-auto-sub", "--sub-lang", "es,en,es-419",
            "--skip-download", "--no-warnings",
            "-o", f"{tmpdir}/sub.%(ext)s",
        ],
        capture_output=True, text=True, timeout=30,
    )
    for f in Path(tmpdir).glob("sub*.vtt"):
        return f.read_text(errors="ignore")
    return None


def whisper_transcribe(url: str, tmpdir: str, duration_limit: int = 600) -> str | None:
    """Download audio and transcribe with Whisper. Skips videos longer than duration_limit seconds."""
    # First check duration without downloading
    probe = subprocess.run(
        [YT_DLP, "--print", "duration", "--no-warnings", url],
        capture_output=True, text=True, timeout=15,
    )
    try:
        dur = int(probe.stdout.strip())
        if dur > duration_limit:
            print(f"    [whisper skip] {dur}s > {duration_limit}s limit")
            return None
    except ValueError:
        pass  # unknown duration, attempt anyway

    try:
        subprocess.run(
            [
                YT_DLP, url,
                "--extract-audio", "--audio-format", "mp3", "--audio-quality", "5",
                "--no-warnings", "-o", f"{tmpdir}/audio.%(ext)s",
            ],
            capture_output=True, text=True, timeout=240,
        )
    except subprocess.TimeoutExpired:
        print("    [whisper skip] download timed out")
        return None
    audio_files = list(Path(tmpdir).glob("audio.*"))
    if not audio_files:
        return None
    try:
        transcription = get_whisper().transcribe(str(audio_files[0]), language="es", fp16=False)
        return transcription.get("text", "").strip()
    except Exception as e:
        print(f"    [whisper error] {e}")
        return None


def geo_from_text(text: str) -> tuple:
    """Keyword then Gemma location extraction from plain text."""
    loc, lat, lng = keyword_location(text)
    if not loc:
        loc, lat, lng = gemma_location(text)
    return loc, lat, lng


def process_instagram():
    """Run Gemma location extraction on Instagram reports with no location."""
    rows = sb.table("reports").select("id,text_content,location_name") \
        .eq("source", "instagram") \
        .is_("lat", "null") \
        .execute().data
    print(f"[transcribe:instagram] {len(rows)} posts without location")
    updated = 0
    for row in rows[:40]:
        text = row.get("text_content", "") or ""
        if not text.strip():
            continue
        loc, lat, lng = geo_from_text(text)
        if loc and loc.lower() not in GENERIC:
            sb.table("reports").update({"location_name": loc, "lat": lat, "lng": lng}).eq("id", row["id"]).execute()
            print(f"  → {loc} ({lat:.4f}, {lng:.4f})")
            updated += 1
    print(f"[transcribe:instagram] {updated}/{min(len(rows),40)} updated")


def main():
    # First pass: geo-locate Instagram captions (fast, no audio needed)
    process_instagram()

    rows = sb.table("reports").select("id,source_url,text_content,location_name") \
        .eq("source", "youtube") \
        .execute().data

    # Prioritise: no location first, then Caracas catch-alls
    no_loc = [r for r in rows if not r.get("location_name")]
    caracas = [r for r in rows if r.get("location_name") == "Caracas"]
    targets = no_loc + caracas
    print(f"[transcribe] {len(targets)} YouTube reports to process ({len(no_loc)} no location, {len(caracas)} Caracas)")

    updated = 0
    for i, row in enumerate(targets[:30]):  # cap at 30 per run
        url = row["source_url"]
        vid_id = url.split("v=")[-1]
        print(f"  [{i+1}/{min(len(targets),30)}] {vid_id} — {(row.get('text_content') or '')[:50]}")

        with tempfile.TemporaryDirectory() as tmp:
            vtt_text = get_subtitles(url, tmp)
            whisper_text = None
            if not vtt_text:
                whisper_text = whisper_transcribe(url, tmp)

        if vtt_text:
            plain = strip_vtt(vtt_text)
            combined = f"{row.get('text_content','')} {plain}"
            loc, lat, lng = keyword_location(combined)
            if not loc:
                loc, lat, lng = gemma_location(plain)
            source = "subtitles"
        elif whisper_text:
            combined = f"{row.get('text_content','')} {whisper_text}"
            loc, lat, lng = keyword_location(combined)
            if not loc:
                loc, lat, lng = gemma_location(whisper_text)
            source = "whisper"
        else:
            # No audio/subs — try Gemma on title alone
            loc, lat, lng = gemma_location(row.get("text_content", ""))
            source = "title+gemma"

        if loc and loc.lower() not in GENERIC:
            sb.table("reports").update({
                "location_name": loc, "lat": lat, "lng": lng
            }).eq("id", row["id"]).execute()
            print(f"    → {loc} ({lat:.4f}, {lng:.4f}) [{source}]")
            updated += 1
        else:
            print(f"    → no specific location found")

    print(f"\n[transcribe] Done — {updated}/{min(len(targets),30)} updated")


if __name__ == "__main__":
    main()
