import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || "";
  const status = searchParams.get("status") || "";
  const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500);
  const offset = parseInt(searchParams.get("offset") || "0");
  const countOnly = searchParams.get("count") === "1";

  const matched = searchParams.get("matched") === "1";
  const extsource = searchParams.get("extsource") || "";

  let base = supabase.from("missing_persons").select(
    countOnly ? "id" : "id,name,age,last_seen_location,lat,lng,description,contact_info,submitted_at,photo_url,status,external_source,source2_url,source_id",
    { count: "exact" }
  ).or("is_duplicate.eq.false,is_duplicate.is.null");

  if (matched) {
    base = base.ilike("external_source", "%SismoVenezuela%");
  } else if (extsource) {
    base = base.ilike("external_source", `${extsource}%`);
  } else {
    if (status === "sin-contacto") base = base.or("status.eq.sin-contacto,status.is.null");
    else if (status === "encontrado") base = base.or("status.eq.encontrado,status.eq.localizado");
  }
  if (q) base = base.ilike("name", `%${q}%`);

  const CACHE = { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=300" } };

  if (countOnly) {
    const { count, error } = await base.limit(1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ total: count ?? 0 }, CACHE);
  }

  const { data, count, error } = await base
    .order("submitted_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [], total: count ?? 0 }, CACHE);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, age, last_seen_location, lat, lng, description, contact_info } = body;

  if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });

  const { data, error } = await supabase
    .from("missing_persons")
    .insert({ name: name.trim(), age: age || null, last_seen_location, lat, lng, description, contact_info })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}
