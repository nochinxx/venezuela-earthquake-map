import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const lat = parseFloat(searchParams.get("lat") ?? "0");
  const lng = parseFloat(searchParams.get("lng") ?? "0");
  const radiusKm = parseFloat(searchParams.get("radius_km") ?? "25");

  const deg = radiusKm / 111.0;

  const sourceFilter = searchParams.get("source") ?? "";

  let query = supabase
    .from("reports")
    .select("id,source,source_url,author,text_content,media_urls,lat,lng,location_name,damage_level,post_time,flag_count,credibility,is_comment,parent_url")
    .gte("lat", lat - deg).lte("lat", lat + deg)
    .gte("lng", lng - deg).lte("lng", lng + deg)
    .eq("hidden", false)
    .order("post_time", { ascending: false })
    .limit(100);

  if (sourceFilter) query = query.eq("source", sourceFilter);

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
