import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data, count, error } = await supabase
    .from("reports")
    .select("source", { count: "exact" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const by_source: Record<string, number> = {};
  for (const row of data ?? []) {
    by_source[row.source] = (by_source[row.source] ?? 0) + 1;
  }

  return NextResponse.json({ total: count ?? 0, by_source });
}
