import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HISTORICAL = [
  { year: 1967, location: "Caracas", magnitude: 6.5, deaths: 1000, note: "Destruyó el este de Caracas; cambió los códigos de construcción." },
  { year: 1997, location: "Cariaco, Sucre", magnitude: 6.9, deaths: 73, note: "Colapso del Liceo Valentín Valiente; 80 estudiantes muertos." },
];

export async function GET() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [buildingsRes, centersRes, reportsRes] = await Promise.all([
    sb.from("building_damage").select("damage_type"),
    // last_confirmed_at added in migration 20260707_relief_centers_expiry.sql
    sb.from("relief_centers").select("id").then(r => r),
    sb.from("reports").select("id", { count: "exact", head: true }),
  ]);

  // Try to get last_confirmed_at separately; gracefully degrade if column not yet migrated
  let centersTs: { id: string; last_confirmed_at: string | null }[] = [];
  try {
    const r = await sb.from("relief_centers").select("id,last_confirmed_at");
    centersTs = (r.data ?? []) as typeof centersTs;
  } catch { /* migration 20260707_relief_centers_expiry.sql not yet applied */ }

  const buildings = buildingsRes.data ?? [];
  const centers = centersRes.data ?? [];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  return NextResponse.json({
    buildings: {
      total: buildings.length,
      total_damage: buildings.filter(b => b.damage_type === "total").length,
      severe_damage: buildings.filter(b => b.damage_type === "severo").length,
      partial_damage: buildings.filter(b => b.damage_type === "parcial").length,
    },
    relief_centers: {
      total: centers.length,
      active: centersTs.filter(c => c.last_confirmed_at && c.last_confirmed_at >= sevenDaysAgo).length,
    },
    reports: {
      total: reportsRes.count ?? 0,
    },
    historical: HISTORICAL,
  });
}
