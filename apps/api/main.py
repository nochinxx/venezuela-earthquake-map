from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from supabase import create_client
from dotenv import load_dotenv
import os

load_dotenv()

app = FastAPI(title="Venezuela Earthquake Map API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_KEY"],
)


class ReportIn(BaseModel):
    source: str
    source_url: str
    source_id: Optional[str] = None
    author: Optional[str] = None
    text_content: Optional[str] = None
    media_urls: list[str] = []
    lat: Optional[float] = None
    lng: Optional[float] = None
    location_name: Optional[str] = None
    damage_level: Optional[int] = None
    post_time: Optional[datetime] = None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/reports/geojson")
def reports_geojson(
    source: Optional[str] = Query(None),
    min_damage: Optional[int] = Query(None, ge=1, le=5),
    limit: int = Query(1000, le=5000),
):
    """GeoJSON FeatureCollection — consumed directly by Mapbox."""
    query = supabase.table("reports").select(
        "id,source,source_url,author,text_content,media_urls,"
        "lat,lng,location_name,damage_level,post_time,verified"
    ).not_.is_("lat", "null").limit(limit)

    if source:
        query = query.eq("source", source)
    if min_damage:
        query = query.gte("damage_level", min_damage)

    result = query.order("post_time", desc=True).execute()
    rows = result.data or []

    features = []
    for r in rows:
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r["lng"], r["lat"]]},
            "properties": {k: v for k, v in r.items() if k not in ("lat", "lng")},
        })

    return {"type": "FeatureCollection", "features": features}


@app.get("/reports/nearby")
def reports_nearby(
    lat: float = Query(...),
    lng: float = Query(...),
    radius_km: float = Query(25.0),
    limit: int = Query(50, le=200),
):
    """All reports within radius_km of a point — shown in the side panel."""
    deg = radius_km / 111.0
    result = supabase.table("reports").select(
        "id,source,source_url,author,text_content,media_urls,"
        "lat,lng,location_name,damage_level,post_time"
    ).gte("lat", lat - deg).lte("lat", lat + deg)\
     .gte("lng", lng - deg).lte("lng", lng + deg)\
     .order("post_time", desc=True).limit(limit).execute()
    return result.data or []


@app.get("/reports/stats")
def reports_stats():
    result = supabase.table("reports").select("source", count="exact").execute()
    by_source = {}
    for row in (result.data or []):
        by_source[row["source"]] = by_source.get(row["source"], 0) + 1
    return {"total": result.count, "by_source": by_source}


@app.post("/ingest", status_code=201)
def ingest(report: ReportIn):
    """Scrapers call this to push a new report."""
    data = report.model_dump(exclude_none=True)
    if "post_time" in data and isinstance(data["post_time"], datetime):
        data["post_time"] = data["post_time"].isoformat()
    try:
        supabase.table("reports").upsert(data, on_conflict="source_url").execute()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
