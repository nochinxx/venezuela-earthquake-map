import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category") || "";
  const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 200);
  const offset = parseInt(searchParams.get("offset") || "0");
  const geojson = searchParams.get("geojson") === "1";

  const now = new Date().toISOString();

  let base = supabase
    .from("needs_requests")
    .select("id,title,description,category,priority,lat,lng,location_name,contact_info,items_needed,source_url,expires_at,created_at", { count: "exact" })
    .eq("is_active", true)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .not("lat", "is", null);

  if (category) base = base.eq("category", category);

  const { data, count, error } = await base
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (geojson) {
    const features = (data ?? []).map((r) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [r.lng, r.lat] },
      properties: r,
    }));
    return NextResponse.json({ type: "FeatureCollection", features });
  }

  return NextResponse.json({ data: data ?? [], total: count ?? 0 });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { title, description, category, location_name, lat, lng, contact_info, items_needed } = body;

  if (!title?.trim()) return NextResponse.json({ error: "title required" }, { status: 400 });

  const expires_at = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("needs_requests")
    .insert({
      title: title.trim(),
      description: description || null,
      category: category || "otro",
      location_name: location_name || null,
      lat: lat || null,
      lng: lng || null,
      contact_info: contact_info || null,
      items_needed: items_needed || null,
      external_source: "manual",
      expires_at,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}
