import { NextResponse } from "next/server";

const LOCATIONS: Record<string, [number, number]> = {
  // Vargas / La Guaira coast (epicenter area)
  "la guaira": [10.6017, -66.9340],
  "guaira": [10.6017, -66.9340],
  "catia la mar": [10.5978, -67.0242],
  "catia": [10.5978, -67.0242],
  "playa grande": [10.5990, -67.0050],
  "caraballeda": [10.6213, -66.8590],
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
  "chiuspa": [10.6500, -66.5300],
  "osma": [10.6177, -66.8700],
  "osman": [10.6177, -66.8700],
  "mamo": [10.5842, -67.1367],
  "maiquetia": [10.5975, -66.9600],
  "maiquetía": [10.5975, -66.9600],
  "corales": [10.6213, -66.8590],
  "puerta del mar": [10.6050, -66.9200],
  "catita": [10.5978, -67.0242],
  "playa oma": [10.6150, -66.9000],
  "playa uma": [10.6150, -66.9000],
  "vargas": [10.6017, -66.9340],
  "litoral": [10.6017, -66.9340],
  "estado vargas": [10.6017, -66.9340],
  "la guairá": [10.6017, -66.9340],
  // Caracas
  "caracas": [10.4806, -66.9036],
  "petare": [10.4805, -66.7832],
  "palos grandes": [10.5040, -66.8558],
  "los palos grandes": [10.5040, -66.8558],
  "altamira": [10.4955, -66.8474],
  "chacao": [10.4942, -66.8516],
  "las mercedes": [10.4780, -66.8670],
  "sabana grande": [10.4870, -66.8870],
  "la candelaria": [10.4905, -66.9005],
  "el paraiso": [10.4867, -66.9217],
  "el paraíso": [10.4867, -66.9217],
  "catia (caracas)": [10.4990, -66.9450],
  "propatria": [10.5027, -66.9571],
  "antimano": [10.4705, -66.9632],
  "macaracuay": [10.4925, -66.8330],
  "guarenas": [10.4637, -66.5393],
  "guatire": [10.4697, -66.5390],
  "los teques": [10.3453, -67.0363],
  "miranda": [10.2300, -66.4300],
  // Aragua / Carabobo
  "maracay": [10.2469, -67.5958],
  "turmero": [10.2256, -67.5157],
  "la victoria": [10.2282, -67.3349],
  "cagua": [10.1878, -67.4639],
  "valencia": [10.1620, -67.9903],
  "puerto cabello": [10.4792, -68.0017],
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
};

function geocode(ubicacion: string): [number, number] | null {
  const lower = ubicacion.toLowerCase().trim();
  // Exact match first
  for (const [key, coords] of Object.entries(LOCATIONS)) {
    if (lower.includes(key)) return coords;
  }
  return null;
}

export const revalidate = 300; // cache 5 min

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = Math.min(parseInt(searchParams.get("pageSize") || "100"), 200);
  const allPages = searchParams.get("all") === "1";

  try {
    if (allPages) {
      // Fetch all pages for map display (up to 500 geolocated records)
      const first = await fetch(
        `https://desaparecidos-terremoto-api.theempire.tech/api/personas?page=1&pageSize=200`,
        { next: { revalidate: 300 } }
      );
      const firstData = await first.json();
      const totalPages = Math.min(firstData.totalPages, 10);

      let all: unknown[] = [...firstData.items];
      for (let p = 2; p <= totalPages; p++) {
        const r = await fetch(
          `https://desaparecidos-terremoto-api.theempire.tech/api/personas?page=${p}&pageSize=200`,
          { next: { revalidate: 300 } }
        );
        const d = await r.json();
        all = all.concat(d.items);
      }

      const features = (all as Record<string, unknown>[])
        .map((item) => {
          const coords = geocode(String(item.ubicacion || ""));
          if (!coords) return null;
          return {
            type: "Feature",
            geometry: { type: "Point", coordinates: [coords[1], coords[0]] },
            properties: {
              id: item.id,
              nombre: item.nombre,
              edad: item.edad,
              ubicacion: item.ubicacion,
              descripcion: item.descripcion,
              contacto: item.contacto,
              foto: item.foto,
              estado: item.estado,
              fecha: item.fecha,
              url: `https://desaparecidosterremotovenezuela.com`,
            },
          };
        })
        .filter(Boolean);

      return NextResponse.json({
        type: "FeatureCollection",
        features,
        meta: { total: firstData.total, geolocated: features.length },
      });
    }

    // Paginated list
    const r = await fetch(
      `https://desaparecidos-terremoto-api.theempire.tech/api/personas?page=${page}&pageSize=${pageSize}`,
      { next: { revalidate: 60 } }
    );
    const data = await r.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
