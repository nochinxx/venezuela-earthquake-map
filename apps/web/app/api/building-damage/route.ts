import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const revalidate = 120; // cache 2 min

export async function GET() {
  const { data, error } = await supabase
    .from("building_damage")
    .select("id,external_id,external_source,lat,lng,place,damage_type,affected,needs,photo_url,confirmations,reported_at")
    .order("reported_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const geojson = {
    type: "FeatureCollection" as const,
    features: (data ?? []).map((r) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [r.lng, r.lat] },
      properties: {
        id: r.id,
        external_id: r.external_id,
        source: r.external_source,
        place: r.place,
        damage_type: r.damage_type,
        affected: r.affected,
        needs: r.needs,
        photo_url: r.photo_url,
        confirmations: r.confirmations,
        reported_at: r.reported_at,
      },
    })),
  };

  return NextResponse.json(geojson);
}
