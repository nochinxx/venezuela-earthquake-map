import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const source = searchParams.get("source");
  const minDamage = searchParams.get("min_damage");

  let query = supabase
    .from("reports")
    .select("id,source,source_url,author,text_content,media_urls,lat,lng,location_name,damage_level,post_time,scraped_at,verified,flag_count,credibility,is_comment,parent_url")
    .not("lat", "is", null)
    .eq("hidden", false)
    .order("post_time", { ascending: false })
    .limit(2000);

  if (source) query = query.eq("source", source);
  if (minDamage) query = query.gte("damage_level", parseInt(minDamage));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const features = (data ?? []).map((r) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [r.lng, r.lat] },
    properties: { ...r, lat: undefined, lng: undefined },
  }));

  return NextResponse.json({ type: "FeatureCollection", features });
}
