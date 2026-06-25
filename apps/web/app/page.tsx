"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

// Empty NEXT_PUBLIC_API_URL = use Next.js API routes (deployed on Vercel, no separate server)
const API = process.env.NEXT_PUBLIC_API_URL || "/api";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora mismo";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days} d`;
}

interface Report {
  id: string;
  source: string;
  source_url: string;
  author: string;
  text_content: string;
  media_urls: string[];
  location_name: string;
  damage_level: number;
  post_time: string | null;
  scraped_at: string | null;
  verified: boolean;
  flag_count: number;
  credibility: "high" | "medium" | "low" | null;
  is_comment: boolean;
  parent_url: string | null;
}

interface ReliefCenter {
  id: string;
  name: string;
  address: string;
  state: string;
  lat: number;
  lng: number;
  source_name: string;
  source_url: string;
  accepted_items: string;
  scraped_at: string;
}

interface MissingPerson {
  id: string;
  name: string;
  age: number | null;
  last_seen_location: string;
  lat: number | null;
  lng: number | null;
  description: string;
  contact_info: string;
  submitted_at: string;
  photo_url?: string | null;
  status?: string | null;
  external_source?: string | null;
  source2_url?: string | null;
}

const EMERGENCY_DIR = [
  {
    category: "🏥 Hospitales — Caracas",
    entries: [
      { name: "Hospital Andrés Herrera Vegas", location: "El Algodonal", phone: "(212) 472.31.38" },
      { name: "Hospital Centro Médico IVSS", location: "Caricuao", phone: "(212) 432.55.11" },
      { name: "Hospital Clínico Universitario", location: "Chaguaramos", phone: "(212) 606.71.11" },
      { name: "Hospital de Clínicas Caracas", location: "San Bernardino", phone: "(212) 508.61.11" },
      { name: "Hospital de Niños J.M. de Los Ríos", location: "San Bernardino", phone: "(212) 574.35.11" },
      { name: "Hospital Dr. Domingo Luciani", location: "El Llanito", phone: "(212) 257.87.12" },
      { name: "Hospital El Algodonal", location: "Antímano", phone: "(212) 472.54.10" },
      { name: "Hospital El Manicomio", location: "Caracas", phone: "(212) 860.13.13" },
      { name: "Hospital José Gregorio Hernández", location: "Los Magallanes", phone: "(212) 870.78.97" },
      { name: "Hospital Miguel Pérez Carreño", location: "Bella Vista", phone: "(212) 472.84.72" },
      { name: "Hospital Militar", location: "San Martín", phone: "(212) 406.12.41" },
      { name: "Hospital Periférico de Catia", location: "Catia", phone: "(212) 870.27.71" },
      { name: "Hospital Periférico de Coche", location: "Coche", phone: "(212) 681.11.33" },
      { name: "Policlínica David Lobo", location: "Santa Rosalía", phone: "(212) 541.54.65" },
      { name: "Policlínica La Arboleda", location: "San Bernardino", phone: "(212) 550.18.11" },
      { name: "Policlínica Las Mercedes", location: "Las Mercedes", phone: "(212) 993.23.23" },
      { name: "Policlínica Santiago de León", location: "Sabana Grande", phone: "(212) 762.90.25" },
      { name: "Centro Clínico / Clínica Razetti", location: "La Candelaria", phone: "(212) 5970248" },
      { name: "Centro Médico de Caracas", location: "San Bernardino", phone: "(212) 555.91.11" },
      { name: "Clínica La Floresta", location: "Los Palos Grandes", phone: "(212) 285.60.58" },
      { name: "Clínica Leopoldo Aguerrevere", location: "Prados del Este", phone: "(212) 907.08.11" },
      { name: "Clínica Rescarven", location: "Santa Cecilia", phone: "(212) 239.56.86" },
    ],
  },
  {
    category: "🚑 Ambulancias",
    entries: [
      { name: "Aeroambulancias", location: "", phone: "(0212) 993.25.41 / 992.89.80 / 992.89.90 / 991.79.40" },
      { name: "Rescarven", location: "", phone: "(0212) 993.69.11 / 993.69.91 / 993.13.10 / 993.33.67" },
      { name: "Servicio Ambulancia Metropolitano", location: "", phone: "(0212) 545.45.45 / 545.46.55 / 577.92.09" },
    ],
  },
  {
    category: "🚒 Bomberos — Caracas",
    entries: [
      { name: "Bomberos Antímano", location: "", phone: "(0212) 472.20.54" },
      { name: "Bomberos Catia la Mar", location: "", phone: "(0212) 351.99.66" },
      { name: "Bomberos Chacao", location: "", phone: "(0212) 265.32.61" },
      { name: "Bomberos del Este / Cafetal", location: "", phone: "(0212) 987.43.34 / 985.50.60" },
      { name: "Bomberos El Paraíso", location: "", phone: "(0212) 481.09.61" },
      { name: "Bomberos El Valle", location: "", phone: "(0212) 672.01.75 / 672.06.36" },
      { name: "Bomberos La Guaira", location: "", phone: "(0212) 332.76.20 / 331.04.45" },
      { name: "Bomberos La Trinidad", location: "", phone: "(0212) 943.43.61" },
      { name: "Bomberos La Urbina", location: "", phone: "(0212) 241.66.41" },
      { name: "Bomberos Metropolitanos", location: "", phone: "(0212) 545.45.45" },
      { name: "Bomberos Miranda", location: "", phone: "(0212) 235.69.67" },
      { name: "Bomberos Plaza Venezuela", location: "", phone: "(0212) 793.00.39 / 793.64.57" },
      { name: "Bomberos San Bernardino", location: "", phone: "(0212) 577.92.09" },
      { name: "Bomberos Sucre", location: "", phone: "(0212) 985.36.40" },
    ],
  },
  {
    category: "🛡️ Protección Civil",
    entries: [
      { name: "Protección Civil (líneas 0800)", location: "", phone: "0800-5588427 / 0800-2668446 / 0800-2624368" },
      { name: "Instituto de Protección Civil", location: "", phone: "(0212) 631.86.62 / 631.90.58 / 662.84.76 / 545.93.91" },
      { name: "Defensa Civil Alcaldía Mayor", location: "", phone: "(0212) 662.67.59 / 662.32.05" },
      { name: "Defensa Civil Nacional", location: "", phone: "0800.28326 / 0800.24845 / (0212) 483.98.05" },
    ],
  },
  {
    category: "👮 Policía",
    entries: [
      { name: "CICPC", location: "", phone: "(0212) 571.35.33 / 571.38.44 / 571.32.66" },
      { name: "Policía Metropolitana", location: "", phone: "(0212) 862.58.71 / 862.58.72" },
      { name: "Policía Municipal Chacao", location: "", phone: "(0212) 264.1256 / 264.00.50" },
      { name: "Policía Municipal Baruta", location: "", phone: "(0212) 943.28.55 / 943.62.77" },
      { name: "Policía Municipal Sucre", location: "", phone: "(0212) 242.21.11 / 242.22.11" },
      { name: "Policía Municipal del Hatillo", location: "", phone: "(0212) 961.16.82" },
    ],
  },
  {
    category: "🚗 Transporte de Emergencia",
    entries: [
      { name: "Yummy — Viajes GRATIS a hospitales y clínicas", location: "Caracas y ciudades afectadas", phone: "App Yummy · @vicentezavarce · 24–25 Jun" },
      { name: "Yummy — Cero surge pricing", location: "Todo el día", phone: "0% comisión para conductores" },
    ],
  },
  {
    category: "⛑️ Rescate",
    entries: [
      { name: "Cuerpo de Emergencias Rescate y Transmisiones", location: "", phone: "(0212) 545.47.47" },
      { name: "Grupo de Rescate Caracas (El Ávila)", location: "", phone: "(0212) 615.63.86 / 415.46.61" },
      { name: "Grupo de Rescate Venezuela", location: "", phone: "(0212) 977.47.10" },
      { name: "Organización de Rescate Humboldt", location: "", phone: "(0212) 234.22.34 / 0414.926.21.39" },
      { name: "Socorristas Cruz Roja", location: "", phone: "(0212) 571.47.13" },
      { name: "Inspectoría de Tránsito (I.N.T.)", location: "", phone: "167" },
      { name: "Brigada Ministerio Transporte Terrestre", location: "", phone: "02125372677" },
    ],
  },
];

const WALKTHROUGH_STEPS = [
  {
    icon: "🌡️",
    title: "Mapa de calor",
    desc: "Cada zona roja representa reportes de daños. El color más intenso indica mayor concentración de reportes en esa área. Los clústeres rojos agrupan varios reportes cercanos.",
  },
  {
    icon: "📍",
    title: "Haz clic en el mapa",
    desc: "Toca cualquier punto o clúster para ver los reportes individuales de esa zona en el panel derecho. Incluye videos de YouTube, tweets, posts de Instagram y comentarios.",
  },
  {
    icon: "🔎",
    title: "Filtra por fuente",
    desc: "Usa los botones en la barra superior para ver solo reportes de YouTube, X/Twitter o Instagram. El panel de reportes también se actualiza con el filtro activo.",
  },
  {
    icon: "📦",
    title: "Centros de acopio",
    desc: "Los puntos verdes 📦 son centros de recolección de donaciones verificados. Haz clic en uno para ver la dirección, estado y qué artículos aceptan.",
  },
  {
    icon: "🧍",
    title: "Personas desaparecidas",
    desc: "Usa '🧍 Desaparecidos' para reportar una persona que no has podido contactar desde el terremoto. Los reportes aparecen como marcadores naranjas en el mapa.",
  },
  {
    icon: "⏱️",
    title: "Actualización automática",
    desc: "El mapa se alimenta de YouTube, X/Twitter e Instagram cada 10 minutos. Recarga la página para ver lo más reciente. Las cifras de víctimas se actualizan desde fuentes verificadas.",
  },
  {
    icon: "📞",
    title: "Números de emergencia",
    desc: "En la esquina inferior izquierda siempre están visibles los números de emergencia: 911 (nacional), 166 (Protección Civil), 167 (Bomberos).",
  },
];

const LOCATIONS_MAP: Record<string, [number, number]> = {
  "caracas": [10.4806, -66.9036], "valencia": [10.162, -67.9903],
  "maracaibo": [10.6316, -71.6428], "barquisimeto": [10.0647, -69.3571],
  "maracay": [10.2469, -67.5958], "yumare": [10.6383, -68.6847],
  "san felipe": [10.3394, -68.7453], "la guaira": [10.6013, -66.9337],
  "cumana": [10.4574, -64.1744], "merida": [8.5916, -71.144],
  "carabobo": [10.162, -67.9903], "miranda": [10.3, -66.6],
  "aragua": [10.2603, -67.5894], "san bernardino": [10.5050, -66.9100],
};

function resolveCoords(location: string): [number | null, number | null] {
  const key = location.toLowerCase().trim();
  const match = Object.entries(LOCATIONS_MAP).find(([k]) => key.includes(k) || k.includes(key));
  return match ? match[1] : [null, null];
}

const DAMAGE_COLOR: Record<number, string> = {
  1: "#fef9c3",
  2: "#fde68a",
  3: "#fb923c",
  4: "#ef4444",
  5: "#7f1d1d",
};

const DAMAGE_LABEL: Record<number, string> = {
  1: "Menor", 2: "Leve", 3: "Moderado", 4: "Severo", 5: "Colapso",
};

type SortOrder = "newest" | "oldest";
type SourceFilter = "" | "twitter" | "instagram" | "youtube";

function FeedCard({ r, flagged, setFlagged, api }: { r: Report; flagged: Set<string>; setFlagged: React.Dispatch<React.SetStateAction<Set<string>>>; api: string }) {
  return (
    <div className="p-3 flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded uppercase shrink-0 ${
            r.source === "twitter" ? "bg-blue-900 text-blue-300" :
            r.source === "instagram" ? "bg-pink-900 text-pink-300" : "bg-red-900 text-red-300"
          }`}>{r.source}</span>
          {r.location_name
            ? <span className="text-xs text-gray-400 truncate">📍 {r.location_name}</span>
            : <span className="text-xs text-gray-600 italic">sin ubicación</span>
          }
          {r.credibility === "high" && <span className="text-xs text-green-400 shrink-0">✓</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {r.source_url && (
            <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300">↗</a>
          )}
          <button onClick={async () => {
            if (flagged.has(r.id)) return;
            await fetch(`${api}/reports/${r.id}`, { method: "POST" });
            setFlagged(f => new Set(f).add(r.id));
          }} className={`text-xs ${flagged.has(r.id) ? "text-orange-400" : "text-gray-600 hover:text-orange-400"}`}>🚩</button>
        </div>
      </div>
      {r.text_content && (
        <p className="text-xs text-gray-300 leading-relaxed line-clamp-4">{r.text_content}</p>
      )}
      {r.media_urls?.length > 0 && (
        <img src={r.media_urls[0]} alt="" className="rounded w-full object-cover max-h-32" />
      )}
      <span className="text-gray-600 text-xs">
        {r.author ? `@${r.author}` : ""}
        {(r.post_time || r.scraped_at) ? ` · ${timeAgo((r.post_time || r.scraped_at)!)}` : ""}
        {r.damage_level ? ` · ${DAMAGE_LABEL[r.damage_level]}` : ""}
      </span>
    </div>
  );
}

export default function Home() {
  const mapRef = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [selected, setSelected] = useState<Report[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [stats, setStats] = useState<{ total: number; by_source: Record<string, number> } | null>(null);
  const [casualties, setCasualties] = useState<{ deaths: number | null; injured: number | null; missing: number | null; source_name: string; source_url: string | null; scraped_at: string } | null>(null);
  const [source, setSource] = useState<SourceFilter>("");
  const [sort, setSort] = useState<SortOrder>("newest");
  const [panelSort, setPanelSort] = useState<SortOrder>("newest");
  const [showSubmit, setShowSubmit] = useState(false);
  const [submitForm, setSubmitForm] = useState({ url: "", location: "", description: "", damage: "3" });
  const [submitStatus, setSubmitStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [reliefCenters, setReliefCenters] = useState<ReliefCenter[]>([]);
  const [showRelief, setShowRelief] = useState(true);
  const [selectedRelief, setSelectedRelief] = useState<ReliefCenter | null>(null);
  const reliefMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const [showMissing, setShowMissing] = useState(false);
  const [missingForm, setMissingForm] = useState({ name: "", age: "", last_seen_location: "", description: "", contact_info: "" });
  const [missingStatus, setMissingStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [showExternalMissing, setShowExternalMissing] = useState(false);
  const [externalMissingTotal, setExternalMissingTotal] = useState<number | null>(null);
  const [externalMissingLoading, setExternalMissingLoading] = useState(false);
  const [selectedExternalPerson, setSelectedExternalPerson] = useState<Record<string, unknown> | null>(null);
  const [panelTab, setPanelTab] = useState<"reports" | "personas" | null>(null);
  const [missingPanelList, setMissingPanelList] = useState<MissingPerson[]>([]);
  const [missingPanelTotal, setMissingPanelTotal] = useState(0);
  const [missingPanelOffset, setMissingPanelOffset] = useState(0);
  const [missingPanelLoading, setMissingPanelLoading] = useState(false);
  const [missingSearch, setMissingSearch] = useState("");
  const [missingStatusFilter, setMissingStatusFilter] = useState<"" | "sin-contacto" | "encontrado">("");
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [walkthroughStep, setWalkthroughStep] = useState(0);
  const [showEmergencyDir, setShowEmergencyDir] = useState(false);
  const [showSources, setShowSources] = useState(false);

  const [legendOpen, setLegendOpen] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(true);
  const [showYummyCard, setShowYummyCard] = useState(true);
  const [showReports, setShowReports] = useState(true);
  const [showBuildings, setShowBuildings] = useState(true);
  const [buildingCount, setBuildingCount] = useState<number | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<Record<string, unknown> | null>(null);
  const buildingPopupRef = useRef<mapboxgl.Popup | null>(null);
  const [feed, setFeed] = useState<Report[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("wt_seen")) setShowWalkthrough(true);
    if (window.innerWidth >= 768) setLegendOpen(true);
  }, []);
  const clickedCoords = useRef<{ lat: number; lng: number } | null>(null);

  function sortReports(rows: Report[], order: SortOrder) {
    return [...rows].sort((a, b) => {
      const ta = a.post_time ? new Date(a.post_time).getTime() : 0;
      const tb = b.post_time ? new Date(b.post_time).getTime() : 0;
      return order === "newest" ? tb - ta : ta - tb;
    });
  }

  async function fetchNearby(lat: number, lng: number, radiusKm: number, srcFilter: string) {
    const p = new URLSearchParams({ lat: String(lat), lng: String(lng), radius_km: String(radiusKm) });
    if (srcFilter) p.set("source", srcFilter);
    const res = await fetch(`${API}/reports/nearby?${p}`);
    const rows: Report[] = await res.json();
    setSelected(rows.map(r => ({ ...r, media_urls: Array.isArray(r.media_urls) ? r.media_urls : [] })));
    setPanelTab("reports");
  }

  function renderReliefMarkers(centers: ReliefCenter[]) {
    reliefMarkersRef.current.forEach(m => m.remove());
    reliefMarkersRef.current = [];
    if (!map.current) return;
    centers.forEach((center) => {
      const el = document.createElement("div");
      el.style.cssText = "width:28px;height:28px;background:#22c55e;border:2px solid #fff;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 2px 6px rgba(0,0,0,0.5)";
      el.innerHTML = "📦";
      el.title = center.name;
      el.onclick = () => setSelectedRelief(center);
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([center.lng, center.lat])
        .addTo(map.current!);
      reliefMarkersRef.current.push(marker);
    });
  }

  function loadData() {
    const p = new URLSearchParams();
    if (source) p.set("source", source);
    fetch(`${API}/casualties`).then((r) => r.json()).then((c) => { if (c) setCasualties(c); }).catch(() => {});
    fetch(`${API}/relief-centers`).then((r) => r.json()).then((centers: ReliefCenter[]) => {
      setReliefCenters(centers);
      renderReliefMarkers(centers);
    }).catch(() => {});
    fetch(`${API}/building-damage`).then((r) => r.json()).then((geojson) => {
      if (!geojson?.features) return;
      setBuildingCount(geojson.features.length);
      const m = map.current;
      if (!m) return;
      const SRC = "building-damage";
      const LAYER = "building-damage-points";
      if (m.getSource(SRC)) {
        (m.getSource(SRC) as mapboxgl.GeoJSONSource).setData(geojson);
        return;
      }
      m.addSource(SRC, { type: "geojson", data: geojson });
      m.addLayer({
        id: LAYER,
        type: "circle",
        source: SRC,
        paint: {
          "circle-color": "#f59e0b",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 7, 12, 11],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff",
          "circle-opacity": 0.92,
        },
      });
      const DAMAGE_LABEL: Record<string, string> = { total: "🔴 Derrumbe total", severo: "🟠 Daño severo", parcial: "🟡 Daño parcial" };
      const SOURCE_URL: Record<string, string> = { "terremotovenezuela.com": "https://terremotovenezuela.com" };
      m.on("click", LAYER, (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const p = feat.properties as Record<string, unknown>;
        const [lng, lat] = (feat.geometry as GeoJSON.Point).coordinates;
        if (buildingPopupRef.current) buildingPopupRef.current.remove();
        const damageLabel = p.damage_type ? (DAMAGE_LABEL[p.damage_type as string] ?? String(p.damage_type)) : "";
        const affected = p.affected ? `<br/>👥 ${p.affected} afectados` : "";
        const confirmed = p.confirmations ? `<br/>✅ ${p.confirmations} confirmaciones` : "";
        const src = p.source as string | undefined;
        const srcLink = src ? `<br/><a href="${SOURCE_URL[src] ?? "#"}" target="_blank" style="color:#1d9bf0;font-size:10px;text-decoration:underline">${src}</a>` : "";
        buildingPopupRef.current = new mapboxgl.Popup({ maxWidth: "280px" })
          .setLngLat([lng, lat])
          .setHTML(
            `<div style="font-size:12px;color:#111;padding:2px 0">
              <strong style="font-size:13px">🏚 ${p.place ?? "Edificio afectado"}</strong>
              ${damageLabel ? `<br/><span style="font-size:11px;font-weight:600">${damageLabel}</span>` : ""}
              ${p.needs ? `<br/><span style="color:#444">${p.needs}</span>` : ""}
              ${affected}${confirmed}${srcLink}
            </div>`
          )
          .addTo(m);
      });
      m.on("mouseenter", LAYER, () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", LAYER, () => { m.getCanvas().style.cursor = ""; });
    }).catch(() => {});
    Promise.all([
      fetch(`${API}/reports/geojson?${p}`).then((r) => r.json()),
      fetch(`${API}/reports/stats`).then((r) => r.json()),
    ]).then(([geojson, statsData]) => {
      setStats(statsData);
      const m = map.current;
      if (!m) return;

      if (m.getSource("reports")) {
        (m.getSource("reports") as mapboxgl.GeoJSONSource).setData(geojson);
        return;
      }

      m.addSource("reports", {
        type: "geojson",
        data: geojson,
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 40,
      });

      m.addLayer({
        id: "reports-heat",
        type: "heatmap",
        source: "reports",
        maxzoom: 10,
        paint: {
          "heatmap-weight": [
            "*",
            ["interpolate", ["linear"], ["get", "damage_level"], 1, 0.2, 5, 1],
            ["match", ["get", "credibility"], "low", 0.4, "high", 1.2, 1.0],
          ],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 10, 3],
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)",
            0.2, "#fde68a",
            0.5, "#fb923c",
            0.8, "#ef4444",
            1, "#7f1d1d",
          ],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 20, 10, 40],
          "heatmap-opacity": 0.8,
        },
      });

      m.addLayer({
        id: "reports-clusters",
        type: "circle",
        source: "reports",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#ef4444",
          "circle-radius": ["step", ["get", "point_count"], 16, 10, 24, 50, 32],
          "circle-opacity": 0.85,
        },
      });

      m.addLayer({
        id: "reports-cluster-count",
        type: "symbol",
        source: "reports",
        filter: ["has", "point_count"],
        layout: { "text-field": "{point_count_abbreviated}", "text-size": 12 },
        paint: { "text-color": "#fff" },
      });

      m.addLayer({
        id: "reports-points",
        type: "circle",
        source: "reports",
        minzoom: 10,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": 7,
          "circle-color": [
            "match", ["to-string", ["get", "damage_level"]],
            "1", DAMAGE_COLOR[1], "2", DAMAGE_COLOR[2],
            "3", DAMAGE_COLOR[3], "4", DAMAGE_COLOR[4],
            "5", DAMAGE_COLOR[5], "#94a3b8",
          ],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff",
        },
      });

      m.on("click", "reports-points", async (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const [lng, lat] = (feat.geometry as GeoJSON.Point).coordinates;
        clickedCoords.current = { lat, lng };
        setSelectedLocation(feat.properties?.location_name ?? null);
        await fetchNearby(lat, lng, 20, source);
      });

      m.on("click", "reports-clusters", (e) => {
        const feat = e.features?.[0];
        if (!feat || !map.current) return;
        const clusterId = feat.properties?.cluster_id;
        const src = map.current.getSource("reports") as mapboxgl.GeoJSONSource;
        src.getClusterLeaves(clusterId, 100, 0, async (_err, leaves) => {
          if (!leaves?.length) return;
          const [lng, lat] = (leaves[0].geometry as GeoJSON.Point).coordinates;
          clickedCoords.current = { lat, lng };
          setSelectedLocation(leaves[0].properties?.location_name ?? null);
          await fetchNearby(lat, lng, 30, source);
        });
      });

      m.on("mouseenter", "reports-points", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "reports-points", () => { m.getCanvas().style.cursor = ""; });
      m.on("mouseenter", "reports-clusters", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "reports-clusters", () => { m.getCanvas().style.cursor = ""; });
    });
  }

  useEffect(() => {
    if (!mapRef.current || map.current) return;
    map.current = new mapboxgl.Map({
      container: mapRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [-66.9, 10.5],
      zoom: 6,
    });
    map.current.on("load", loadData);
    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");
  }, []);

  useEffect(() => {
    if (map.current?.loaded()) loadData();
    // Re-fetch panel with new filter if it's open
    if (clickedCoords.current && selected.length > 0) {
      fetchNearby(clickedCoords.current.lat, clickedCoords.current.lng, 25, source);
    }
  }, [source]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const vis = showReports ? "visible" : "none";
    ["reports-heat", "reports-clusters", "reports-cluster-count", "reports-points"].forEach(id => {
      if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", vis);
    });
  }, [showReports]);

  useEffect(() => {
    reliefMarkersRef.current.forEach(m => {
      const el = m.getElement();
      el.style.display = showRelief ? "flex" : "none";
    });
  }, [showRelief]);


  // External missing persons (desaparecidosterremotovenezuela.com)
  useEffect(() => {
    const m = map.current;
    if (!m || !m.loaded()) return;

    const SRC = "ext-missing";
    const LAYER_CLUSTER = "ext-missing-cluster";
    const LAYER_COUNT = "ext-missing-count";
    const LAYER_POINT = "ext-missing-point";

    if (!showExternalMissing) {
      [LAYER_CLUSTER, LAYER_COUNT, LAYER_POINT].forEach(l => { if (m.getLayer(l)) m.removeLayer(l); });
      if (m.getSource(SRC)) m.removeSource(SRC);
      return;
    }

    setExternalMissingLoading(true);
    fetch(`${API}/missing-persons/external?all=1`)
      .then(r => r.json())
      .then((geojson) => {
        setExternalMissingTotal(geojson.meta?.total ?? null);
        if (m.getSource(SRC)) {
          (m.getSource(SRC) as mapboxgl.GeoJSONSource).setData(geojson);
          return;
        }
        m.addSource(SRC, { type: "geojson", data: geojson, cluster: true, clusterMaxZoom: 13, clusterRadius: 35 });

        m.addLayer({ id: LAYER_CLUSTER, type: "circle", source: SRC, filter: ["has", "point_count"],
          paint: { "circle-color": "#7c3aed", "circle-radius": ["step", ["get", "point_count"], 14, 10, 20, 100, 26], "circle-opacity": 0.85, "circle-stroke-width": 1.5, "circle-stroke-color": "#fff" } });

        m.addLayer({ id: LAYER_COUNT, type: "symbol", source: SRC, filter: ["has", "point_count"],
          layout: { "text-field": "{point_count_abbreviated}", "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"], "text-size": 11 },
          paint: { "text-color": "#fff" } });

        m.addLayer({ id: LAYER_POINT, type: "circle", source: SRC, filter: ["!", ["has", "point_count"]],
          paint: { "circle-color": ["case", ["==", ["get", "estado"], "localizado"], "#22c55e", "#7c3aed"], "circle-radius": 6, "circle-stroke-width": 1.5, "circle-stroke-color": "#fff", "circle-opacity": 0.9 } });

        m.on("click", LAYER_CLUSTER, (e) => {
          const features = m.queryRenderedFeatures(e.point, { layers: [LAYER_CLUSTER] });
          const clusterId = features[0].properties?.cluster_id;
          (m.getSource(SRC) as mapboxgl.GeoJSONSource).getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err || !zoom) return;
            const coords = (features[0].geometry as GeoJSON.Point).coordinates as [number, number];
            m.easeTo({ center: coords, zoom });
          });
          setPanelTab("personas");
        });

        m.on("click", LAYER_POINT, (e) => {
          const props = e.features?.[0]?.properties;
          if (props) {
            setSelectedExternalPerson(props as Record<string, unknown>);
            setPanelTab("personas");
          }
        });

        m.on("mouseenter", LAYER_CLUSTER, () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", LAYER_CLUSTER, () => { m.getCanvas().style.cursor = ""; });
        m.on("mouseenter", LAYER_POINT, () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", LAYER_POINT, () => { m.getCanvas().style.cursor = ""; });
      })
      .catch(() => {})
      .finally(() => setExternalMissingLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showExternalMissing]);

  // Building damage visibility toggle (layer is set up in loadData)
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (m.getLayer("building-damage-points")) {
      m.setLayoutProperty("building-damage-points", "visibility", showBuildings ? "visible" : "none");
    }
  }, [showBuildings]);

  // Missing persons panel loader — resets list when filters/search change
  useEffect(() => {
    if (panelTab !== "personas") return;
    setMissingPanelOffset(0);
    setMissingPanelList([]);
    setMissingPanelLoading(true);
    const p = new URLSearchParams({ limit: "100", offset: "0" });
    if (missingSearch) p.set("q", missingSearch);
    if (missingStatusFilter) p.set("status", missingStatusFilter);
    fetch(`${API}/missing-persons?${p}`)
      .then(r => r.json())
      .then((res: { data: MissingPerson[]; total: number }) => {
        setMissingPanelList(res.data ?? []);
        setMissingPanelTotal(res.total ?? 0);
        setMissingPanelOffset(100);
      })
      .catch(() => {})
      .finally(() => setMissingPanelLoading(false));
  }, [panelTab, missingSearch, missingStatusFilter]);

  function loadMoreMissing() {
    setMissingPanelLoading(true);
    const p = new URLSearchParams({ limit: "100", offset: String(missingPanelOffset) });
    if (missingSearch) p.set("q", missingSearch);
    if (missingStatusFilter) p.set("status", missingStatusFilter);
    fetch(`${API}/missing-persons?${p}`)
      .then(r => r.json())
      .then((res: { data: MissingPerson[]; total: number }) => {
        setMissingPanelList(prev => [...prev, ...(res.data ?? [])]);
        setMissingPanelTotal(res.total ?? 0);
        setMissingPanelOffset(prev => prev + 100);
      })
      .catch(() => {})
      .finally(() => setMissingPanelLoading(false));
  }

  // Auto-load source feed when a filter is active and no map location is selected
  useEffect(() => {
    if (!source || selected.length > 0) { setFeed([]); return; }
    setFeedLoading(true);
    fetch(`${API}/reports/feed?source=${source}&limit=60`)
      .then(r => r.json())
      .then((rows: Report[]) => {
        setFeed(rows.map(r => ({ ...r, media_urls: Array.isArray(r.media_urls) ? r.media_urls : [] })));
        setPanelTab("reports");
      })
      .catch(() => {})
      .finally(() => setFeedLoading(false));
  }, [source, selected.length]);

  const sortedSelected = sortReports(selected, panelSort);

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-950 text-white">
      {/* Collapsible alert banners */}
      <div className="shrink-0">
        {/* Collapsed summary row — always visible */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 border-b border-gray-800 cursor-pointer select-none"
          onClick={() => setBannerOpen(v => !v)}
        >
          <span className="text-amber-400 text-xs font-bold shrink-0">⚠️ USGS</span>
          <span className="text-gray-300 text-xs truncate">
            <span className="text-white font-bold">{casualties?.deaths ?? "—"}</span>
            <span className="text-red-400"> confirmados</span>
            <span className="text-red-600 text-xs ml-1">(parcial)</span>
            <span className="text-gray-500 mx-1">·</span>
            <span className="text-amber-300">10K–100K est. USGS</span>
          </span>
          <span className="ml-auto text-gray-600 text-xs shrink-0">{bannerOpen ? "▲" : "▼"}</span>
        </div>

        {/* Expanded details */}
        {bannerOpen && (
          <>
            <div className="bg-amber-950 border-b border-amber-800 px-4 py-1.5 flex items-center gap-3 flex-wrap">
              <span className="text-amber-400 font-bold text-xs uppercase tracking-wide">⚠️ USGS Alerta Roja</span>
              <span className="text-amber-100 text-xs">
                Proyección más probable: <strong>10,000 – 100,000 víctimas fatales</strong>
                <span className="text-amber-500 ml-1 hidden sm:inline">(41% · escenario extremo: +100,000)</span>
              </span>
              <a href="https://earthquake.usgs.gov/earthquakes/eventpage/atth5pbk/pager" target="_blank" rel="noopener noreferrer"
                className="text-amber-500 text-xs hover:text-amber-300 ml-auto shrink-0">USGS PAGER →</a>
            </div>
            <div className="bg-red-950 border-b border-red-800 px-4 py-2 flex items-center gap-3 flex-wrap">
              <span className="text-red-300 font-bold text-xs uppercase tracking-wide">Confirmados</span>
              <span className="text-white font-bold text-sm">{casualties?.deaths ?? "—"} <span className="text-red-300 font-normal text-xs">muertos</span></span>
              {casualties?.injured != null && <span className="text-white font-bold text-sm">{casualties.injured}+ <span className="text-red-300 font-normal text-xs">heridos</span></span>}
              {casualties?.missing != null && <span className="text-white font-bold text-sm">{casualties.missing} <span className="text-red-300 font-normal text-xs">desaparecidos</span></span>}
              <span className="text-red-400 text-xs hidden sm:inline italic">⚠ Cifra parcial · excluye La Guaira</span>
              <span className="text-red-500 text-xs ml-auto italic hidden sm:inline">
                {casualties?.source_url ? (
                  <a href={casualties.source_url} target="_blank" rel="noopener noreferrer" className="hover:text-red-300 underline">
                    {casualties.source_name ?? "Fuente oficial"}
                  </a>
                ) : (casualties?.source_name ?? "Cifra oficial pendiente")}
                {casualties?.scraped_at ? ` · ${timeAgo(casualties.scraped_at)}` : ""}
              </span>
            </div>
          </>
        )}
      </div>
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 shrink-0">
        {/* Main header row */}
        <div className="flex items-center justify-between px-3 py-2 gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-bold text-red-400 text-base leading-tight truncate">🇻🇪 SismoVenezuela</h1>
              <button
                onClick={() => setShowSources(true)}
                className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-900/60 text-blue-300 border border-blue-700/40 hover:bg-blue-800/60 transition-colors shrink-0"
                title="Ver fuentes consolidadas"
              >
                Consolida 5 fuentes
              </button>
            </div>
            {stats && (
              <p className="text-gray-500 text-xs">
                <span className="text-gray-300 font-semibold">{stats.total}</span> reportes
                <span className="hidden sm:inline text-gray-600">
                  {stats.by_source && Object.entries(stats.by_source).map(([s, n]) => (
                    <span key={s} className="ml-2">{s}: {n}</span>
                  ))}
                </span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setSort(s => s === "newest" ? "oldest" : "newest")}
              className="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-400 hover:bg-gray-700 hidden sm:block">
              {sort === "newest" ? "↓ Recientes" : "↑ Antiguos"}
            </button>
            <button onClick={() => { setShowSubmit(true); setSubmitStatus("idle"); }}
              className="px-2.5 py-1 rounded text-xs bg-red-700 hover:bg-red-600 text-white font-semibold">
              + Reportar
            </button>
            <a href="https://ko-fi.com/venezuelaearthquakemap" target="_blank" rel="noopener noreferrer"
              className="px-2 py-0.5 rounded text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 hidden sm:inline-flex items-center gap-1"
              title="Apoya este proyecto">
              ☕ Donar
            </a>
            <button onClick={() => setShowSources(true)}
              className="px-2 py-0.5 rounded text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 hidden sm:flex items-center gap-1 shrink-0"
              title="Fuentes y recursos aliados">
              🔗 Fuentes
            </button>
            <button onClick={() => { setShowWalkthrough(true); setWalkthroughStep(0); }}
              className="w-7 h-7 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-bold flex items-center justify-center shrink-0"
              title="¿Cómo usar el mapa?">
              ?
            </button>
          </div>
        </div>

        {/* Unified layer pills — all map layers in one scrollable row */}
        <div className="flex gap-1 px-3 pb-2 overflow-x-auto scrollbar-hide items-center">
          {/* Reset all */}
          <button
            onClick={() => { setSource(""); setShowReports(true); setShowRelief(true); setShowBuildings(true); }}
            className="px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors">
            Todas
          </button>

          <span className="text-gray-700 text-xs shrink-0 mx-0.5">·</span>

          {/* Reportes group */}
          <button
            onClick={() => setShowReports(v => !v)}
            className={`px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${showReports ? "bg-red-700 text-white" : "bg-gray-800 text-gray-500 hover:bg-gray-700"}`}>
            📡 Reportes
          </button>
          {(["youtube", "twitter", "instagram"] as const).map((s) => (
            <button key={s}
              onClick={() => { setShowReports(true); setSource(source === s ? "" : s); }}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap shrink-0 transition-colors border ${
                showReports && source === s
                  ? "bg-red-600 text-white border-red-500"
                  : showReports
                  ? "bg-gray-800 text-gray-400 hover:bg-gray-700 border-gray-700"
                  : "bg-gray-900 text-gray-600 border-gray-800 cursor-default"
              }`}
              disabled={!showReports}>
              {s === "twitter" ? "X" : s === "youtube" ? "YT" : "IG"}
            </button>
          ))}

          <span className="text-gray-700 text-xs shrink-0 mx-0.5">·</span>

          {/* Desaparecidos */}
          <button
            onClick={() => { setShowExternalMissing(v => !v); if (!showExternalMissing) setPanelTab("personas"); }}
            className={`px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-colors flex items-center gap-1 ${showExternalMissing ? "bg-violet-800 text-violet-100" : "bg-gray-800 text-gray-500 hover:bg-gray-700"}`}>
            🧍 Desaparecidos
            {showExternalMissing && externalMissingTotal != null && <span className="text-violet-300 text-[10px]">· {externalMissingTotal.toLocaleString()}</span>}
            {showExternalMissing && (
              <span className="text-violet-400 text-[10px] hover:text-white underline decoration-dotted" onClick={(e) => { e.stopPropagation(); setShowSources(true); }}>↗</span>
            )}
          </button>

          {/* Acopios */}
          <button
            onClick={() => setShowRelief(v => !v)}
            className={`px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-colors flex items-center gap-1 ${showRelief ? "bg-green-800 text-green-100" : "bg-gray-800 text-gray-500 hover:bg-gray-700"}`}>
            📦 Acopios
            {showRelief && (
              <span className="text-green-400 text-[10px] hover:text-white underline decoration-dotted" onClick={(e) => { e.stopPropagation(); setShowSources(true); }}>↗</span>
            )}
          </button>

          {/* Edificios */}
          <button
            onClick={() => setShowBuildings(v => !v)}
            className={`px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap shrink-0 transition-colors flex items-center gap-1 ${showBuildings ? "bg-amber-800 text-amber-100" : "bg-gray-800 text-gray-500 hover:bg-gray-700"}`}>
            🏚 Edificios
            {showBuildings && buildingCount != null && <span className="text-amber-300 text-[10px]">· {buildingCount}</span>}
            {showBuildings && (
              <span className="text-amber-400 text-[10px] hover:text-white underline decoration-dotted" onClick={(e) => { e.stopPropagation(); setShowSources(true); }}>↗</span>
            )}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        <div ref={mapRef} className="flex-1" />

        {/* Unified tabbed panel */}
        {panelTab !== null && (
          <>
          {/* Desktop */}
          <div className="hidden md:flex flex-col absolute right-0 top-0 h-full w-96 bg-gray-900/95 border-l border-gray-800 z-10">
            {/* Tab bar */}
            <div className="flex border-b border-gray-800 shrink-0 bg-gray-900">
              <button onClick={() => setPanelTab("reports")}
                className={`flex-1 py-2.5 text-xs font-semibold transition-colors border-b-2 ${panelTab === "reports" ? "text-red-400 border-red-500" : "text-gray-500 border-transparent hover:text-gray-300"}`}>
                📢 Reportes{selected.length > 0 ? ` (${selected.length})` : feed.length > 0 ? ` (${feed.length})` : ""}
              </button>
              <button onClick={() => setPanelTab("personas")}
                className={`flex-1 py-2.5 text-xs font-semibold transition-colors border-b-2 ${panelTab === "personas" ? "text-violet-400 border-violet-500" : "text-gray-500 border-transparent hover:text-gray-300"}`}>
                🧍 Personas{missingPanelTotal > 0 ? ` (${missingPanelTotal.toLocaleString()})` : ""}
              </button>
              <button onClick={() => { setPanelTab(null); setSelected([]); setSelectedLocation(null); setSelectedExternalPerson(null); }}
                className="px-3 text-gray-500 hover:text-white text-lg leading-none shrink-0">×</button>
            </div>

            {/* Reports tab */}
            {panelTab === "reports" && (
              <div className="flex flex-col flex-1 overflow-hidden">
                {selected.length > 0 && (
                  <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 shrink-0">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-semibold text-white text-sm">📍 {selectedLocation ?? "Zona afectada"}</p>
                        <p className="text-gray-400 text-xs">{selected.length} reporte{selected.length !== 1 ? "s" : ""}</p>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => setPanelSort("newest")} className={`px-2 py-0.5 rounded text-xs ${panelSort === "newest" ? "bg-red-600 text-white" : "bg-gray-800 text-gray-400"}`}>↓ Recientes</button>
                        <button onClick={() => setPanelSort("oldest")} className={`px-2 py-0.5 rounded text-xs ${panelSort === "oldest" ? "bg-red-600 text-white" : "bg-gray-800 text-gray-400"}`}>↑ Antiguos</button>
                      </div>
                    </div>
                  </div>
                )}
                {feed.length > 0 && selected.length === 0 && (
                  <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 shrink-0 flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-white text-sm capitalize">
                        {source === "twitter" ? "📢 X / Twitter" : source === "instagram" ? "📸 Instagram" : "▶️ YouTube"}
                      </p>
                      <p className="text-gray-400 text-xs">{feed.length} reportes · incluye sin ubicación</p>
                    </div>
                    <button onClick={() => { setSource(""); setFeed([]); }} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
                  </div>
                )}
                <div className="overflow-y-auto flex flex-col divide-y divide-gray-800 flex-1">
                  {selected.length > 0 ? sortedSelected.map((r) => (
                    <div key={r.id} className={`p-4 flex flex-col gap-2 ${r.is_comment ? "bg-gray-950/60" : ""}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          {r.is_comment ? (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-gray-800 text-gray-400">💬 comentario</span>
                          ) : (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded uppercase ${r.source === "twitter" ? "bg-blue-900 text-blue-300" : r.source === "instagram" ? "bg-pink-900 text-pink-300" : r.source === "web" ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}`}>{r.source}</span>
                          )}
                          {r.credibility === "low" && <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-500 border border-yellow-800">baja confiabilidad</span>}
                          {r.credibility === "high" && <span className="text-xs px-1.5 py-0.5 rounded bg-green-900/50 text-green-400 border border-green-800">verificado</span>}
                        </div>
                        {r.damage_level && (
                          <div className="flex items-center gap-1">
                            <div className="w-2 h-2 rounded-full" style={{ background: DAMAGE_COLOR[r.damage_level] }} />
                            <span className="text-xs text-gray-400">{DAMAGE_LABEL[r.damage_level]}</span>
                          </div>
                        )}
                      </div>
                      {r.text_content && <p className={`text-sm leading-relaxed ${r.is_comment ? "text-gray-400 italic" : "text-gray-300"}`}>{r.text_content}</p>}
                      {r.is_comment && r.parent_url && <a href={r.parent_url} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-600 hover:text-gray-400">Ver video original →</a>}
                      {!r.is_comment && r.media_urls?.length > 0 && <img src={r.media_urls[0]} alt="media" className="rounded w-full object-cover max-h-40" />}
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-xs">
                          {r.author ? `@${r.author}` : ""}
                          {(r.post_time || r.scraped_at) ? ` · ${timeAgo((r.post_time || r.scraped_at)!)}` : ""}
                        </span>
                        <div className="flex items-center gap-2">
                          {!r.is_comment && <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300">Ver fuente →</a>}
                          <button title="Reportar como falso" onClick={async () => {
                            if (flagged.has(r.id)) return;
                            await fetch(`${API}/reports/${r.id}`, { method: "POST" });
                            setFlagged(f => new Set(f).add(r.id));
                            setSelected(sel => sel.filter(s => s.id !== r.id || (s.flag_count ?? 0) < 2));
                          }} className={`text-xs transition-colors ${flagged.has(r.id) ? "text-orange-400 cursor-default" : "text-gray-600 hover:text-orange-400"}`}>
                            {flagged.has(r.id) ? "🚩 reportado" : "🚩"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )) : feed.length > 0 ? (
                    feedLoading ? <p className="text-gray-500 text-sm p-4">Cargando...</p> :
                    feed.map((r) => <FeedCard key={r.id} r={r} flagged={flagged} setFlagged={setFlagged} api={API} />)
                  ) : (
                    <p className="text-gray-500 text-sm p-6 text-center">Haz clic en el mapa para ver reportes de la zona.</p>
                  )}
                </div>
              </div>
            )}

            {/* Personas tab */}
            {panelTab === "personas" && (
              <div className="flex flex-col flex-1 overflow-hidden">
                {/* Highlighted person from map click */}
                {selectedExternalPerson && (() => {
                  const ep = selectedExternalPerson as { nombre?: string; edad?: number; estado?: string; foto?: string; ubicacion?: string; descripcion?: string; contacto?: string; };
                  return (
                    <div className="px-4 py-3 border-b border-violet-800/40 bg-violet-950/20 shrink-0">
                      <div className="flex items-start gap-3">
                        {ep.foto
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={ep.foto} alt={ep.nombre ?? ""} className="w-14 h-14 rounded-lg object-cover shrink-0 border border-gray-700" />
                          : null}
                        <div className="flex-1 min-w-0">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${ep.estado === "localizado" ? "bg-green-800 text-green-300" : "bg-violet-900 text-violet-300"}`}>
                            {ep.estado === "localizado" ? "✓ Localizado" : "Sin contacto"}
                          </span>
                          <p className="font-bold text-white text-sm mt-1 truncate">{ep.nombre}</p>
                          {ep.edad ? <p className="text-gray-400 text-xs">{ep.edad} años</p> : null}
                          {ep.ubicacion ? <p className="text-gray-400 text-xs truncate">📍 {ep.ubicacion}</p> : null}
                          {ep.descripcion ? <p className="text-gray-500 text-xs line-clamp-2 mt-0.5">{ep.descripcion}</p> : null}
                          <a href="https://desaparecidosterremotovenezuela.com" target="_blank" rel="noopener noreferrer" className="text-xs text-violet-400 hover:text-violet-300 mt-1 inline-block">
                            desaparecidosterremotovenezuela.com →
                          </a>
                        </div>
                        <button onClick={() => setSelectedExternalPerson(null)} className="text-gray-500 hover:text-white text-lg leading-none shrink-0">×</button>
                      </div>
                    </div>
                  );
                })()}
                {/* Search + filters */}
                <div className="px-4 py-3 border-b border-gray-800 shrink-0 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <p className="text-gray-400 text-xs">
                      {missingPanelLoading && missingPanelList.length === 0 ? "Cargando..." : (
                        <><span className="text-white font-medium">{missingPanelList.length}</span> de <span className="text-white font-medium">{missingPanelTotal.toLocaleString()}</span> registros</>
                      )}
                    </p>
                    <button onClick={() => { setShowMissing(true); setMissingStatus("idle"); }} className="px-2 py-0.5 rounded text-xs bg-orange-800 hover:bg-orange-700 text-white">+ Reportar</button>
                  </div>
                  <input value={missingSearch} onChange={e => setMissingSearch(e.target.value)} placeholder="Buscar por nombre..."
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-violet-500" />
                  <div className="flex gap-1">
                    {([["", "Todos"], ["sin-contacto", "Sin contacto"], ["encontrado", "Encontrados"]] as const).map(([val, label]) => (
                      <button key={val} onClick={() => setMissingStatusFilter(val)}
                        className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${missingStatusFilter === val ? (val === "encontrado" ? "bg-green-700 text-white" : "bg-violet-700 text-white") : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* List */}
                <div className="overflow-y-auto flex flex-col divide-y divide-gray-800 flex-1">
                  {missingPanelList.map((p) => (
                    <div key={p.id} className="px-4 py-3 flex gap-3 hover:bg-gray-800/50 transition-colors">
                      {p.photo_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={p.photo_url} alt={p.name} className="w-12 h-12 rounded-lg object-cover shrink-0 border border-gray-700" />
                        : <div className="w-12 h-12 rounded-lg bg-gray-800 shrink-0 flex items-center justify-center text-gray-600 text-lg">👤</div>}
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-semibold text-white text-sm truncate">{p.name}</p>
                          {p.age ? <span className="text-gray-500 text-xs shrink-0">{p.age} años</span> : null}
                          <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${p.status === "encontrado" ? "bg-green-900 text-green-300" : "bg-orange-900/50 text-orange-400"}`}>
                            {p.status === "encontrado" ? "✓ Encontrado" : "Sin contacto"}
                          </span>
                        </div>
                        {p.last_seen_location ? <p className="text-gray-400 text-xs truncate">📍 {p.last_seen_location}</p> : null}
                        {p.contact_info ? <p className="text-gray-500 text-xs truncate">☎ {p.contact_info}</p> : null}
                        <div className="flex items-center gap-2 mt-0.5">
                          {p.external_source && (
                            <a href={p.source2_url || (p.external_source === "desaparecidos-vzla" ? "https://desaparecidosterremotovenezuela.com" : "https://venezuelatebusca.com")}
                              target="_blank" rel="noopener noreferrer" className="text-xs text-violet-400 hover:text-violet-300">
                              {p.external_source === "venezulatebusca" ? "venezulatebusca.com" : "desaparecidos.com"} →
                            </a>
                          )}
                          {p.lat && p.lng && (
                            <button onClick={() => { map.current?.flyTo({ center: [p.lng!, p.lat!], zoom: 14, duration: 1000 }); setPanelTab(null); }}
                              className="text-xs text-gray-500 hover:text-gray-300">ver en mapa</button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {!missingPanelLoading && missingPanelList.length === 0 && (
                    <p className="text-gray-500 text-sm p-4 text-center">No se encontraron resultados.</p>
                  )}
                  {missingPanelList.length > 0 && missingPanelList.length < missingPanelTotal && (
                    <div className="p-3 flex justify-center">
                      <button onClick={loadMoreMissing} disabled={missingPanelLoading}
                        className="px-4 py-2 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium disabled:opacity-50">
                        {missingPanelLoading ? "Cargando..." : `Cargar más (${missingPanelTotal - missingPanelList.length} restantes)`}
                      </button>
                    </div>
                  )}
                  <div className="p-3 border-t border-gray-800">
                    <p className="text-gray-600 text-xs text-center">
                      <a href="https://desaparecidosterremotovenezuela.com" className="text-violet-500 hover:text-violet-300" target="_blank" rel="noopener noreferrer">desaparecidosterremotovenezuela.com</a>
                      {" · "}
                      <a href="https://venezuelatebusca.com" className="text-violet-500 hover:text-violet-300" target="_blank" rel="noopener noreferrer">venezuelatebusca.com</a>
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Mobile: bottom sheet */}
          <div className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-900/98 border-t border-gray-800 z-20 flex flex-col max-h-[70vh]">
            {/* Tab bar */}
            <div className="flex border-b border-gray-800 shrink-0">
              <button onClick={() => setPanelTab("reports")}
                className={`flex-1 py-2.5 text-xs font-semibold border-b-2 ${panelTab === "reports" ? "text-red-400 border-red-500" : "text-gray-500 border-transparent"}`}>
                📢 Reportes{selected.length > 0 ? ` (${selected.length})` : ""}
              </button>
              <button onClick={() => setPanelTab("personas")}
                className={`flex-1 py-2.5 text-xs font-semibold border-b-2 ${panelTab === "personas" ? "text-violet-400 border-violet-500" : "text-gray-500 border-transparent"}`}>
                🧍 Personas{missingPanelTotal > 0 ? ` (${missingPanelTotal.toLocaleString()})` : ""}
              </button>
              <button onClick={() => { setPanelTab(null); setSelected([]); setSelectedLocation(null); setSelectedExternalPerson(null); }}
                className="px-3 text-gray-500 text-lg leading-none shrink-0">×</button>
            </div>

            {/* Reports tab – mobile */}
            {panelTab === "reports" && (
              <>
                {selected.length > 0 && (
                  <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
                    <div>
                      <p className="font-semibold text-white text-sm">📍 {selectedLocation ?? "Zona afectada"}</p>
                      <p className="text-gray-400 text-xs">{selected.length} reporte{selected.length !== 1 ? "s" : ""}</p>
                    </div>
                    <button onClick={() => setPanelSort(s => s === "newest" ? "oldest" : "newest")}
                      className="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-400">
                      {panelSort === "newest" ? "↓ Recientes" : "↑ Antiguos"}
                    </button>
                  </div>
                )}
                {feed.length > 0 && selected.length === 0 && (
                  <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
                    <p className="font-semibold text-white text-sm capitalize">
                      {source === "instagram" ? "📸 Instagram" : source === "twitter" ? "📢 X/Twitter" : "▶️ YouTube"}
                      <span className="text-gray-500 font-normal text-xs ml-2">{feed.length} reportes</span>
                    </p>
                    <button onClick={() => { setSource(""); setFeed([]); }} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
                  </div>
                )}
                <div className="overflow-y-auto flex flex-col divide-y divide-gray-800">
                  {selected.length > 0 ? sortedSelected.map((r) => (
                    <div key={`m-${r.id}`} className="p-3 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {r.is_comment
                            ? <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">💬</span>
                            : <span className={`text-xs font-semibold px-1.5 py-0.5 rounded uppercase ${r.source === "twitter" ? "bg-blue-900 text-blue-300" : r.source === "instagram" ? "bg-pink-900 text-pink-300" : "bg-red-900 text-red-300"}`}>{r.source}</span>
                          }
                          {r.credibility === "low" && <span className="text-xs text-yellow-500">⚠ baja</span>}
                          {r.credibility === "high" && <span className="text-xs text-green-400">✓ verif.</span>}
                          {r.damage_level && <span className="text-xs text-gray-400">· {DAMAGE_LABEL[r.damage_level]}</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {!r.is_comment && <a href={r.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400">↗</a>}
                          <button onClick={async () => {
                            if (flagged.has(r.id)) return;
                            await fetch(`${API}/reports/${r.id}`, { method: "POST" });
                            setFlagged(f => new Set(f).add(r.id));
                          }} className={`text-xs ${flagged.has(r.id) ? "text-orange-400" : "text-gray-600"}`}>🚩</button>
                        </div>
                      </div>
                      {r.text_content && <p className={`text-xs leading-relaxed line-clamp-3 ${r.is_comment ? "text-gray-400 italic" : "text-gray-300"}`}>{r.text_content}</p>}
                      <span className="text-gray-600 text-xs">{r.author ? `@${r.author}` : ""}{r.post_time ? ` · ${timeAgo(r.post_time)}` : ""}</span>
                    </div>
                  )) : feed.length > 0 ? (
                    feed.map((r) => <FeedCard key={`m-${r.id}`} r={r} flagged={flagged} setFlagged={setFlagged} api={API} />)
                  ) : (
                    <p className="text-gray-500 text-sm p-6 text-center">Haz clic en el mapa para ver reportes.</p>
                  )}
                </div>
              </>
            )}

            {/* Personas tab – mobile */}
            {panelTab === "personas" && (
              <>
                {selectedExternalPerson && (() => {
                  const ep = selectedExternalPerson as { nombre?: string; edad?: number; estado?: string; foto?: string; ubicacion?: string; };
                  return (
                    <div className="px-3 py-2.5 border-b border-violet-800/40 bg-violet-950/20 shrink-0 flex gap-3 items-start">
                      {ep.foto
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={ep.foto} alt={ep.nombre ?? ""} className="w-12 h-12 rounded-lg object-cover shrink-0" />
                        : null}
                      <div className="flex-1 min-w-0">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${ep.estado === "localizado" ? "bg-green-800 text-green-300" : "bg-violet-900 text-violet-300"}`}>
                          {ep.estado === "localizado" ? "✓ Localizado" : "Sin contacto"}
                        </span>
                        <p className="font-bold text-white text-sm mt-1 truncate">{ep.nombre}</p>
                        {ep.ubicacion ? <p className="text-gray-400 text-xs truncate">📍 {ep.ubicacion}</p> : null}
                      </div>
                      <button onClick={() => setSelectedExternalPerson(null)} className="text-gray-500 text-lg leading-none shrink-0">×</button>
                    </div>
                  );
                })()}
                <div className="px-3 py-2 shrink-0 flex flex-col gap-2 border-b border-gray-800">
                  <div className="flex items-center justify-between">
                    <p className="text-gray-400 text-xs"><span className="text-white">{missingPanelList.length}</span> de {missingPanelTotal.toLocaleString()}</p>
                    <button onClick={() => { setShowMissing(true); setMissingStatus("idle"); }} className="px-2 py-0.5 rounded text-xs bg-orange-800 text-white">+ Reportar</button>
                  </div>
                  <input value={missingSearch} onChange={e => setMissingSearch(e.target.value)} placeholder="Buscar por nombre..."
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none" />
                  <div className="flex gap-1">
                    {([["", "Todos"], ["sin-contacto", "Sin contacto"], ["encontrado", "Encontrados"]] as const).map(([val, label]) => (
                      <button key={val} onClick={() => setMissingStatusFilter(val)}
                        className={`px-2 py-0.5 rounded text-xs ${missingStatusFilter === val ? "bg-violet-700 text-white" : "bg-gray-800 text-gray-400"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="overflow-y-auto flex flex-col divide-y divide-gray-800">
                  {missingPanelList.map((p) => (
                    <div key={`m-${p.id}`} className="px-3 py-2.5 flex gap-2.5">
                      {p.photo_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={p.photo_url} alt={p.name} className="w-10 h-10 rounded object-cover shrink-0 border border-gray-700" />
                        : <div className="w-10 h-10 rounded bg-gray-800 shrink-0 flex items-center justify-center text-gray-600">👤</div>}
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-1 flex-wrap">
                          <p className="font-semibold text-white text-sm truncate">{p.name}</p>
                          {p.age ? <span className="text-gray-500 text-xs">{p.age}a</span> : null}
                        </div>
                        {p.last_seen_location ? <p className="text-gray-400 text-xs truncate">📍 {p.last_seen_location}</p> : null}
                        <span className={`text-xs px-1 py-0.5 rounded w-fit ${p.status === "encontrado" ? "bg-green-900 text-green-300" : "bg-orange-900/50 text-orange-400"}`}>
                          {p.status === "encontrado" ? "✓" : "Sin contacto"}
                        </span>
                      </div>
                    </div>
                  ))}
                  {missingPanelList.length > 0 && missingPanelList.length < missingPanelTotal && (
                    <div className="p-3 flex justify-center shrink-0">
                      <button onClick={loadMoreMissing} disabled={missingPanelLoading}
                        className="px-4 py-2 rounded bg-gray-800 text-gray-300 text-xs disabled:opacity-50">
                        {missingPanelLoading ? "Cargando..." : `Cargar más (${missingPanelTotal - missingPanelList.length} restantes)`}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          </>
        )}

        {/* Yummy emergency service card — time-sensitive 24-25 Jun */}
        {showYummyCard && (
          <div className="absolute top-3 left-3 z-10 max-w-[220px]">
            <div className="relative flex flex-col gap-1 bg-green-950/95 border border-green-700 rounded-lg px-3 py-2.5">
              <button
                onClick={() => setShowYummyCard(false)}
                className="absolute top-1.5 right-1.5 text-green-700 hover:text-green-400 text-sm leading-none"
                aria-label="Cerrar">×</button>
              <a href="https://www.instagram.com/p/DZ_40JluPsA/" target="_blank" rel="noopener noreferrer"
                className="flex flex-col gap-1 hover:opacity-90 transition-opacity">
                <div className="flex items-center gap-1.5">
                  <span className="text-green-400 font-bold text-xs uppercase tracking-wide">🚗 Yummy</span>
                  <span className="text-green-600 text-xs">· 24–25 Jun</span>
                </div>
                <p className="text-white text-xs font-semibold leading-tight">Viajes gratis a hospitales y clínicas</p>
                <p className="text-green-300 text-xs leading-tight">Cero surge pricing · 0% comisión conductores</p>
                <p className="text-green-600 text-xs">@vicentezavarce →</p>
              </a>
            </div>
          </div>
        )}

        <div className="absolute bottom-4 left-3 flex flex-col gap-2 z-10 max-w-[180px] md:max-w-none">
          {/* Emergency box — collapsed pill on mobile, full on desktop */}
          <div className="bg-red-950/95 border border-red-700 rounded text-xs">
            <button
              onClick={() => setLegendOpen(v => !v)}
              className="flex items-center justify-between w-full px-3 py-2 gap-3"
            >
              <span className="font-bold text-red-300 uppercase tracking-wide whitespace-nowrap">📞 Emergencias</span>
              {!legendOpen && <span className="text-white font-bold text-sm">911</span>}
              <span className="text-red-600 text-xs ml-auto">{legendOpen ? "▼" : "▲"}</span>
            </button>
            {legendOpen && (
              <div className="px-3 pb-3 flex flex-col gap-1.5 border-t border-red-900">
                <div className="flex items-center justify-between gap-4 pt-2">
                  <span className="text-gray-400">Emergencia</span>
                  <span className="font-bold text-white">911</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-gray-400">Protección Civil</span>
                  <span className="font-bold text-white">166</span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-gray-400">Bomberos</span>
                  <span className="font-bold text-white">167</span>
                </div>
                <button onClick={() => setShowEmergencyDir(true)}
                  className="mt-1 text-red-400 hover:text-red-200 text-left underline text-xs">
                  Ver directorio →
                </button>
              </div>
            )}
          </div>

          {/* Damage legend */}
          {legendOpen && (
            <div className="bg-gray-900/90 rounded p-3 text-xs flex flex-col gap-1.5">
              <p className="font-semibold text-gray-300 mb-1">Nivel de daño</p>
              {Object.entries(DAMAGE_COLOR).map(([lvl, color]) => (
                <div key={lvl} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-gray-400">{DAMAGE_LABEL[Number(lvl)]}</span>
                </div>
              ))}
              <div className="border-t border-gray-700 mt-1 pt-1.5 flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500 shrink-0" />
                <span className="text-gray-400">Acopio</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-orange-500 shrink-0" />
                <span className="text-gray-400">Desaparecido</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Relief center detail panel */}
      {selectedRelief && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 border border-green-700 rounded-xl shadow-xl w-full max-w-sm p-4 flex flex-col gap-2">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-green-900 text-green-300 uppercase">Centro de acopio</span>
              <p className="font-bold text-white mt-1.5">{selectedRelief.name}</p>
            </div>
            <button onClick={() => setSelectedRelief(null)} className="text-gray-500 hover:text-white text-xl leading-none ml-2">×</button>
          </div>
          <p className="text-gray-300 text-sm">{selectedRelief.address}</p>
          {selectedRelief.state && <p className="text-gray-500 text-xs">{selectedRelief.state}</p>}
          {selectedRelief.accepted_items && (
            <p className="text-green-400 text-xs"><span className="text-gray-500">Acepta: </span>{selectedRelief.accepted_items}</p>
          )}
          <div className="flex items-center justify-between mt-1">
            <span className="text-gray-600 text-xs">{selectedRelief.source_name}</span>
            {selectedRelief.source_url && (
              <a href={selectedRelief.source_url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-green-400 hover:text-green-300">Ver fuente →</a>
            )}
          </div>
        </div>
      )}

      {/* Emergency directory modal */}
      {showEmergencyDir && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-red-800 rounded-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
              <div>
                <h2 className="font-bold text-white text-lg">📞 Directorio de Emergencias — Venezuela</h2>
                <p className="text-gray-500 text-xs mt-0.5">Fuente: @cusicavzla · 24/06/26</p>
              </div>
              <button onClick={() => setShowEmergencyDir(false)} className="text-gray-500 hover:text-white text-2xl leading-none ml-4">×</button>
            </div>

            {/* Carrier note */}
            <div className="px-6 py-2 bg-gray-800/50 border-b border-gray-800 shrink-0">
              <p className="text-gray-400 text-xs">
                <span className="text-yellow-400 font-semibold">Números de emergencia según operadora:</span>{" "}
                171 (Cantv fijo) · *1 (Movilnet) · 112 (Digitel) · 911 (Movistar)
              </p>
            </div>

            <div className="overflow-y-auto px-6 py-4 flex flex-col gap-6">
              {EMERGENCY_DIR.map((section) => (
                <div key={section.category}>
                  <h3 className="font-bold text-red-400 text-sm mb-2">{section.category}</h3>
                  <div className="flex flex-col gap-1">
                    {section.entries.map((e, i) => (
                      <div key={i} className="flex items-start justify-between gap-4 py-1.5 border-b border-gray-800/60 last:border-0">
                        <div className="flex flex-col min-w-0">
                          <span className="text-white text-xs font-medium">{e.name}</span>
                          {e.location && <span className="text-gray-500 text-xs">{e.location}</span>}
                        </div>
                        <span className="text-green-400 text-xs font-mono shrink-0">{e.phone}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Safety tips */}
              <div>
                <h3 className="font-bold text-yellow-400 text-sm mb-2">⚠️ Recomendaciones</h3>
                <ol className="flex flex-col gap-1.5 text-gray-400 text-xs list-decimal list-inside">
                  <li>Evitar edificaciones con daños estructurales.</li>
                  <li>En casa: quita obstáculos de los pasillos, deja las llaves en la puerta.</li>
                  <li>Ten a mano ropa, zapatos y tu bolso de emergencia.</li>
                  <li>Mantén teléfonos y powerbanks cargados.</li>
                  <li>Ten una linterna cerca, evita velas.</li>
                  <li>Mascotas: collarines, correas y kenels listos.</li>
                  <li className="text-red-400 font-semibold">Evita replicar rumores. Revisa solo fuentes verificadas.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sources & partner sites modal */}
      {showSources && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowSources(false); }}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
              <div>
                <h2 className="font-bold text-white text-lg">🔗 Fuentes y recursos aliados</h2>
                <p className="text-gray-500 text-xs mt-0.5">Plataformas ciudadanas que están respondiendo al terremoto del 24 Jun 2026</p>
              </div>
              <button onClick={() => setShowSources(false)} className="text-gray-500 hover:text-white text-2xl leading-none ml-4">×</button>
            </div>
            <div className="overflow-y-auto px-6 py-5 flex flex-col gap-4">

              {/* SismoVenezuela — us */}
              <div className="flex gap-4 items-start p-4 rounded-xl bg-red-950/30 border border-red-900/50">
                <div className="text-2xl shrink-0">🇻🇪</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-white text-sm">SismoVenezuela</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-900 text-red-300">este mapa</span>
                  </div>
                  <p className="text-gray-400 text-xs mt-1">Mapa de calor en tiempo real de daños, personas desaparecidas y centros de acopio. Agrega reportes de YouTube, X/Twitter e Instagram cada 10 min. 14K+ personas desaparecidas de 2 fuentes.</p>
                  <span className="text-gray-600 text-xs">sismovenezuela.com</span>
                </div>
              </div>

              {[
                {
                  emoji: "🏗️",
                  name: "Terremoto Venezuela",
                  url: "https://terremotovenezuela.com",
                  tag: "daños estructurales",
                  tagColor: "bg-orange-900 text-orange-300",
                  author: "@mariangelli",
                  desc: "Mapa colaborativo de daños a edificaciones. 153 edificios reportados: 61 colapsos totales, 46 daños severos, 46 parciales. Permite subir fotos y descripción del daño.",
                },
                {
                  emoji: "🆘",
                  name: "Terremoto Venezuela App",
                  url: "https://terremotovenezuela.app",
                  tag: "rescate y ayuda",
                  tagColor: "bg-blue-900 text-blue-300",
                  author: "Allan Odreman · Cristian Mock · Vicky Torres · Andrés G.",
                  desc: "Plataforma open-source de coordinación de rescate. 6 tipos de marcadores: emergencias críticas, suministros, centros de acopio, apagones, desaparecidos y daños. Directorio de emergencias integrado.",
                },
                {
                  emoji: "🔍",
                  name: "Venezuela Te Busca",
                  url: "https://venezuelatebusca.com",
                  tag: "desaparecidos",
                  tagColor: "bg-violet-900 text-violet-300",
                  author: null,
                  desc: "Base de datos de personas desaparecidas con búsqueda por nombre y cédula. SismoVenezuela sincroniza sus registros cada 30 min y detecta duplicados automáticamente.",
                },
                {
                  emoji: "📋",
                  name: "Venezuela Reporta",
                  url: "https://venezuelareporta.org",
                  tag: "desaparecidos",
                  tagColor: "bg-violet-900 text-violet-300",
                  author: "buscados.org",
                  desc: "Registro comunitario con 15,977 personas reportadas y 633 localizadas. Permite crear carteles de búsqueda compartibles. Datos no verificados — comunidad-reportados.",
                },
                {
                  emoji: "📂",
                  name: "Desaparecidos Terremoto Venezuela",
                  url: "https://desaparecidosterremotovenezuela.com",
                  tag: "desaparecidos",
                  tagColor: "bg-violet-900 text-violet-300",
                  author: null,
                  desc: "Directorio de personas desaparecidas con API pública. SismoVenezuela sincroniza sus 8K+ registros cada 30 min con geocodificación automática por zona.",
                },
              ].map((s) => (
                <div key={s.url} className="flex gap-4 items-start p-4 rounded-xl bg-gray-800/40 border border-gray-700/50 hover:border-gray-600 transition-colors">
                  <div className="text-2xl shrink-0">{s.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a href={s.url} target="_blank" rel="noopener noreferrer"
                        className="font-bold text-white text-sm hover:text-blue-300 transition-colors">
                        {s.name} ↗
                      </a>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${s.tagColor}`}>{s.tag}</span>
                    </div>
                    {s.author && <p className="text-gray-500 text-xs mt-0.5">Por {s.author}</p>}
                    <p className="text-gray-400 text-xs mt-1 leading-relaxed">{s.desc}</p>
                    <span className="text-gray-600 text-xs">{s.url.replace("https://", "")}</span>
                  </div>
                </div>
              ))}

              <div className="border-t border-gray-800 pt-3">
                <p className="text-gray-600 text-xs text-center">
                  ¿Tienes una plataforma de respuesta? Escríbenos para ser incluidos.
                  Todos los datos son de voluntarios — verifica siempre con autoridades oficiales.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Missing persons modal */}
      {showMissing && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-orange-700 rounded-xl w-full max-w-md p-6 flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="font-bold text-white text-lg">🧍 Persona desaparecida</h2>
                <p className="text-gray-400 text-xs mt-0.5">Reporta a alguien que no has podido contactar desde el terremoto.</p>
              </div>
              <button onClick={() => setShowMissing(false)} className="text-gray-500 hover:text-white text-2xl leading-none ml-2">×</button>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Nombre completo *</label>
                <input value={missingForm.name} onChange={e => setMissingForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ej: María González"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-gray-400 text-xs mb-1 block">Edad (opcional)</label>
                  <input value={missingForm.age} onChange={e => setMissingForm(f => ({ ...f, age: e.target.value }))}
                    type="number" placeholder="35"
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500" />
                </div>
                <div className="flex-1">
                  <label className="text-gray-400 text-xs mb-1 block">Última ubicación conocida</label>
                  <input value={missingForm.last_seen_location} onChange={e => setMissingForm(f => ({ ...f, last_seen_location: e.target.value }))}
                    placeholder="Ej: Yumare, Yaracuy"
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500" />
                </div>
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Descripción (señas, ropa, contexto)</label>
                <textarea value={missingForm.description} onChange={e => setMissingForm(f => ({ ...f, description: e.target.value }))}
                  rows={3} placeholder="Estaba en casa cuando ocurrió el sismo. No ha respondido desde las 10am."
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500 resize-none" />
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Contacto para información</label>
                <input value={missingForm.contact_info} onChange={e => setMissingForm(f => ({ ...f, contact_info: e.target.value }))}
                  placeholder="Teléfono, Instagram, o email"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500" />
              </div>
            </div>

            <button
              disabled={!missingForm.name || missingStatus === "sending"}
              onClick={async () => {
                setMissingStatus("sending");
                const [lat, lng] = resolveCoords(missingForm.last_seen_location);
                try {
                  const res = await fetch(`${API}/missing-persons`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...missingForm, age: missingForm.age ? parseInt(missingForm.age) : null, lat, lng }),
                  });
                  if (res.ok) {
                    setMissingStatus("done");
                    setMissingForm({ name: "", age: "", last_seen_location: "", description: "", contact_info: "" });
                    setTimeout(() => setShowMissing(false), 2000);
                  } else {
                    setMissingStatus("error");
                  }
                } catch { setMissingStatus("error"); }
              }}
              className="w-full py-2 rounded bg-orange-700 hover:bg-orange-600 disabled:opacity-40 text-white font-semibold text-sm transition-colors">
              {missingStatus === "sending" ? "Enviando..." : missingStatus === "done" ? "¡Reporte enviado!" : missingStatus === "error" ? "Error — intenta de nuevo" : "Reportar desaparecido"}
            </button>
          </div>
        </div>
      )}


      {/* Walkthrough modal */}
      {showWalkthrough && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { localStorage.setItem("wt_seen","1"); setShowWalkthrough(false); } }}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-6 flex flex-col gap-5">
            <div className="flex justify-between items-center">
              <span className="text-gray-500 text-xs">{walkthroughStep + 1} / {WALKTHROUGH_STEPS.length}</span>
              <button onClick={() => { localStorage.setItem("wt_seen","1"); setShowWalkthrough(false); }} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
            </div>

            <div className="flex flex-col items-center text-center gap-3">
              <div className="text-5xl">{WALKTHROUGH_STEPS[walkthroughStep].icon}</div>
              <h3 className="text-white font-bold text-lg">{WALKTHROUGH_STEPS[walkthroughStep].title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{WALKTHROUGH_STEPS[walkthroughStep].desc}</p>
            </div>

            <div className="flex justify-center gap-1.5">
              {WALKTHROUGH_STEPS.map((_, i) => (
                <div key={i} className={`h-1.5 rounded-full transition-all ${i === walkthroughStep ? "w-6 bg-red-500" : "w-1.5 bg-gray-700"}`} />
              ))}
            </div>

            <div className="flex gap-2">
              {walkthroughStep > 0 && (
                <button onClick={() => setWalkthroughStep(s => s - 1)}
                  className="flex-1 py-2 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium">
                  ← Anterior
                </button>
              )}
              {walkthroughStep < WALKTHROUGH_STEPS.length - 1 ? (
                <button onClick={() => setWalkthroughStep(s => s + 1)}
                  className="flex-1 py-2 rounded bg-red-600 hover:bg-red-500 text-white text-sm font-semibold">
                  Siguiente →
                </button>
              ) : (
                <button onClick={() => { localStorage.setItem("wt_seen","1"); setShowWalkthrough(false); }}
                  className="flex-1 py-2 rounded bg-red-600 hover:bg-red-500 text-white text-sm font-semibold">
                  Entendido ✓
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Submit report modal */}
      {showSubmit && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <h2 className="font-bold text-white text-lg">Reportar daño</h2>
              <button onClick={() => setShowSubmit(false)} className="text-gray-500 hover:text-white text-2xl leading-none">×</button>
            </div>
            <p className="text-gray-400 text-xs">¿Viste daños? Comparte el enlace y nosotros extraemos la ubicación y la añadimos al mapa.</p>

            <div className="flex flex-col gap-3">
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Enlace (tweet, IG, video, noticia) *</label>
                <input value={submitForm.url} onChange={e => setSubmitForm(f => ({ ...f, url: e.target.value }))}
                  placeholder="https://..."
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-red-500" />
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Ciudad / zona afectada</label>
                <input value={submitForm.location} onChange={e => setSubmitForm(f => ({ ...f, location: e.target.value }))}
                  placeholder="Ej: Valencia, Carabobo"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-red-500" />
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Descripción (opcional)</label>
                <textarea value={submitForm.description} onChange={e => setSubmitForm(f => ({ ...f, description: e.target.value }))}
                  rows={3} placeholder="¿Qué pasó? ¿Hay heridos, daños estructurales?"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-red-500 resize-none" />
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Nivel de daño</label>
                <div className="flex gap-2">
                  {([1,2,3,4,5] as const).map(n => (
                    <button key={n} onClick={() => setSubmitForm(f => ({ ...f, damage: String(n) }))}
                      className={`flex-1 py-1 rounded text-xs font-medium border transition-colors ${
                        submitForm.damage === String(n)
                          ? "border-red-500 text-white"
                          : "border-gray-700 text-gray-500 hover:border-gray-500"
                      }`}
                      style={submitForm.damage === String(n) ? { background: DAMAGE_COLOR[n] + "33", borderColor: DAMAGE_COLOR[n] } : {}}>
                      {n} {DAMAGE_LABEL[n]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              disabled={!submitForm.url || submitStatus === "sending"}
              onClick={async () => {
                setSubmitStatus("sending");
                const [lat, lng] = resolveCoords(submitForm.location);
                const payload = {
                  source: "web",
                  source_url: submitForm.url,
                  text_content: submitForm.description || submitForm.location,
                  location_name: submitForm.location || null,
                  lat, lng,
                  damage_level: parseInt(submitForm.damage),
                };
                try {
                  const res = await fetch(`${API}/ingest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                  setSubmitStatus(res.ok ? "done" : "error");
                  if (res.ok) { setSubmitForm({ url: "", location: "", description: "", damage: "3" }); setTimeout(() => setShowSubmit(false), 2000); }
                } catch { setSubmitStatus("error"); }
              }}
              className="w-full py-2 rounded bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-semibold text-sm transition-colors">
              {submitStatus === "sending" ? "Enviando..." : submitStatus === "done" ? "¡Reporte enviado!" : submitStatus === "error" ? "Error — intenta de nuevo" : "Enviar reporte"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
