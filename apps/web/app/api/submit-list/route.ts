import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const hospital = String(body.hospital ?? "").trim();
  if (!hospital) {
    return NextResponse.json({ error: "El campo hospital/fuente es obligatorio" }, { status: 400 });
  }

  const { error } = await supabase.from("submitted_lists").insert({
    submitter: String(body.submitter ?? "").trim() || null,
    hospital,
    tweet_url: String(body.tweetUrl ?? "").trim() || null,
    names: String(body.names ?? "").trim() || null,
    status: "pending",
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
