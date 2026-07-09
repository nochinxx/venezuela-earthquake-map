import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const { data, error } = await supabase
    .from("news_digest")
    .select("digest_date,deaths_confirmed,injuries_confirmed,infrastructure,gov_response,key_events,key_events_en,es_summary,en_summary,sources,generated_at")
    .order("digest_date", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return NextResponse.json({ digest: null }, { status: 200 });
  }

  return NextResponse.json({ digest: data });
}
