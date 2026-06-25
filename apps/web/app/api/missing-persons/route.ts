import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim().toLowerCase() || "";
  const status = searchParams.get("status") || "";
  const limit = Math.min(parseInt(searchParams.get("limit") || "200"), 500);

  let query = supabase
    .from("missing_persons")
    .select("id,name,age,last_seen_location,lat,lng,description,contact_info,submitted_at,photo_url,status,external_source,source2_url")
    .order("submitted_at", { ascending: false })
    .limit(limit);

  if (status === "sin-contacto") query = query.or("status.eq.sin-contacto,status.is.null");
  else if (status === "encontrado") query = query.eq("status", "encontrado");
  if (q) query = (query as typeof query).ilike("name", `%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
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
