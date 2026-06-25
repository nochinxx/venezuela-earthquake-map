import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("missing_persons")
    .select("id,name,age,last_seen_location,lat,lng,description,contact_info,submitted_at")
    .order("submitted_at", { ascending: false });

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
