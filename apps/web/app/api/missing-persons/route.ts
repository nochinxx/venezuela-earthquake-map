import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Restricted while missing-persons data is under review — see CLAUDE.md
export async function GET() {
  return NextResponse.json({ error: "Temporarily unavailable" }, { status: 403 });
}

export async function POST() {
  return NextResponse.json({ error: "Temporarily unavailable" }, { status: 403 });
}
