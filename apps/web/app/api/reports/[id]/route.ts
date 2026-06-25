import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/reports/[id] — flag as fake news
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;

  // Increment flag_count and auto-hide at threshold 3
  const { data: current } = await supabase
    .from("reports")
    .select("flag_count")
    .eq("id", id)
    .single();

  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });

  const newCount = (current.flag_count ?? 0) + 1;
  const shouldHide = newCount >= 3;

  const { error } = await supabase
    .from("reports")
    .update({ flag_count: newCount, ...(shouldHide ? { hidden: true } : {}) })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ flagged: true, hidden: shouldHide, flag_count: newCount });
}

// DELETE /api/reports/[id] — admin removal (requires Authorization: Bearer <SUPABASE_SERVICE_KEY>)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace("Bearer ", "").trim();
  if (token !== process.env.SUPABASE_SERVICE_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { error } = await supabase.from("reports").update({ hidden: true }).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
