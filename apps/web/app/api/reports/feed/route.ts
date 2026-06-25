import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/reports/feed?source=instagram&limit=60
// Returns recent reports regardless of whether they have coordinates.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const source = searchParams.get("source");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "60"), 200);

  let query = supabase
    .from("reports")
    .select("id,source,source_url,author,text_content,media_urls,lat,lng,location_name,damage_level,post_time,scraped_at,flag_count,credibility,is_comment,parent_url")
    .eq("hidden", false)
    .eq("is_comment", false)
    .order("scraped_at", { ascending: false })
    .limit(limit);

  if (source) query = query.eq("source", source);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
