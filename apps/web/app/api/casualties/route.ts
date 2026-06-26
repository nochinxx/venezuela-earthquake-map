import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  // Prefer manually-entered rows (auto_extracted=false) over scraped ones.
  // Among same type, take the most recent.
  const { data, error } = await supabase
    .from("casualty_stats")
    .select("*")
    .order("auto_extracted", { ascending: true })
    .order("scraped_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? null, { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=300" } });
}
