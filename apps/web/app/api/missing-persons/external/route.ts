import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const LOCATIONS: Record<string, [number, number]> = {
  // Vargas / La Guaira coast (epicenter area)
  "la guaira": [10.6017, -66.9340],
  "la guairá": [10.6017, -66.9340],
  "guaira": [10.6017, -66.9340],
  "litoral": [10.6017, -66.9340],
  "vargas": [10.6017, -66.9340],
  "estado vargas": [10.6017, -66.9340],
  "catia la mar": [10.5978, -67.0242],
  "playa grande": [10.5990, -67.0050],
  "caraballeda": [10.6213, -66.8590],
  "los corales": [10.6213, -66.8590],
  "macuto": [10.6109, -66.8843],
  "tanaguarena": [10.6161, -66.8487],
  "tanaguarenas": [10.6161, -66.8487],
  "naiguata": [10.6277, -66.7495],
  "naiguatá": [10.6277, -66.7495],
  "los caracas": [10.6239, -66.6854],
  "caribe": [10.6050, -66.9200],
  "urimare": [10.6364, -66.6219],
  "carayaca": [10.5541, -67.1066],
  "chuspa": [10.6500, -66.5300],
  "osma": [10.6177, -66.8700],
  "mamo": [10.5842, -67.1367],
  "maiquetia": [10.5975, -66.9600],
  "maiquetía": [10.5975, -66.9600],
  "puerta del mar": [10.6050, -66.9200],
  "playa oma": [10.6150, -66.9000],
  // Caracas
  "caracas": [10.4806, -66.9036],
  "petare": [10.4805, -66.7832],
  "palos grandes": [10.5040, -66.8558],
  "altamira": [10.4955, -66.8474],
  "chacao": [10.4942, -66.8516],
  "las mercedes": [10.4780, -66.8670],
  "sabana grande": [10.4870, -66.8870],
  "la candelaria": [10.4905, -66.9005],
  "el paraiso": [10.4867, -66.9217],
  "el paraíso": [10.4867, -66.9217],
  "propatria": [10.5027, -66.9571],
  "antimano": [10.4705, -66.9632],
  "macaracuay": [10.4925, -66.8330],
  "guarenas": [10.4637, -66.5393],
  "guatire": [10.4697, -66.5390],
  "los teques": [10.3453, -67.0363],
  "miranda": [10.2300, -66.4300],
  "san bernardino": [10.5060, -66.9020],
  "bello campo": [10.4942, -66.8516],
  "bello monte": [10.4780, -66.8670],
  "el rosal": [10.4902, -66.8584],
  "chuao": [10.4960, -66.8440],
  "la castellana": [10.4981, -66.8567],
  "los dos caminos": [10.5014, -66.8419],
  "la california": [10.4975, -66.8357],
  "prados del este": [10.4612, -66.8538],
  "el hatillo": [10.4377, -66.8259],
  "baruta": [10.4290, -66.8759],
  "catia": [10.4990, -66.9450],
  "cua": [10.1631, -66.8856],
  // Aragua / Carabobo
  "maracay": [10.2469, -67.5958],
  "turmero": [10.2256, -67.5157],
  "la victoria": [10.2282, -67.3349],
  "cagua": [10.1878, -67.4639],
  "valencia": [10.1620, -67.9903],
  "puerto cabello": [10.4792, -68.0017],
  "carabobo": [10.1620, -67.9903],
  "tocuyito": [10.1277, -68.0859],
  "naguanagua": [10.2148, -67.9854],
  // Other states
  "barquisimeto": [10.0647, -69.3571],
  "maracaibo": [10.6316, -71.6428],
  "merida": [8.5916, -71.1440],
  "mérida": [8.5916, -71.1440],
  "cumaná": [10.4574, -64.1744],
  "cumana": [10.4574, -64.1744],
  "barcelona": [10.1403, -64.6919],
  "puerto la cruz": [10.2123, -64.6335],
  "maturin": [9.7487, -63.1820],
  "maturín": [9.7487, -63.1820],
  "ciudad guayana": [8.3518, -62.6512],
  "san cristobal": [7.7731, -72.2273],
  "san cristóbal": [7.7731, -72.2273],
  "yumare": [10.6383, -68.6847],
  "san felipe": [10.3394, -68.7453],
  "acarigua": [9.5574, -69.1978],
  "guanare": [9.0426, -69.7455],
  "porlamar": [10.9588, -63.8591],
};

function geocode(location: string): [number, number] | null {
  const lower = location.toLowerCase().trim();
  // Longest-key match first to avoid short keys swallowing longer ones (e.g. "catia" vs "catia la mar")
  const sorted = Object.entries(LOCATIONS).sort((a, b) => b[0].length - a[0].length);
  for (const [key, coords] of sorted) {
    if (lower.includes(key)) return coords;
  }
  return null;
}

const PAGE = 1000;

export const revalidate = 300; // 5-min cache

export async function GET() {
  try {
    // Stream all non-duplicate records from our own Supabase table
    const all: Record<string, unknown>[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("missing_persons")
        .select("id,name,age,last_seen_location,description,contact_info,external_source,photo_url,submitted_at")
        .or("is_duplicate.eq.false,is_duplicate.is.null")
        .or("status.eq.sin-contacto,status.is.null")
        .range(offset, offset + PAGE - 1);
      if (error || !data?.length) break;
      all.push(...data);
      if (data.length < PAGE) break;
      offset += PAGE;
    }

    const features = all
      .map((item) => {
        const loc = String(item.last_seen_location ?? "");
        const coords = geocode(loc);
        if (!coords) return null;
        // Small random jitter so stacked pins don't collapse into one dot
        const jitter = () => (Math.random() - 0.5) * 0.006;
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [coords[1] + jitter(), coords[0] + jitter()] },
          properties: {
            id: item.id,
            nombre: item.name,
            edad: item.age,
            ubicacion: item.last_seen_location,
            descripcion: item.description,
            contacto: item.contact_info,
            foto: item.photo_url,
            estado: null,
            external_source: item.external_source,
          },
        };
      })
      .filter(Boolean);

    return NextResponse.json({
      type: "FeatureCollection",
      features,
      meta: { total: all.length, geolocated: features.length },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
