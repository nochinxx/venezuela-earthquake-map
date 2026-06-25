import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("relief_centers")
    .select("id,name,address,state,lat,lng,source_name,source_url,accepted_items,scraped_at")
    .eq("active", true)
    .not("lat", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
