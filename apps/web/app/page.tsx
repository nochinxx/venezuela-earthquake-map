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
  post_time: string;
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
}

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
  const [missingPersons, setMissingPersons] = useState<MissingPerson[]>([]);
  const missingMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [walkthroughStep, setWalkthroughStep] = useState(0);
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

  function renderMissingMarkers(persons: MissingPerson[]) {
    missingMarkersRef.current.forEach(m => m.remove());
    missingMarkersRef.current = [];
    if (!map.current) return;
    persons.forEach((person) => {
      if (!person.lat || !person.lng) return;
      const el = document.createElement("div");
      el.style.cssText = "width:28px;height:28px;background:#f97316;border:2px solid #fff;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 2px 6px rgba(0,0,0,0.5)";
      el.innerHTML = "🧍";
      el.title = person.name;
      const popup = new mapboxgl.Popup({ offset: 16, closeButton: false })
        .setHTML(`<div style="color:#111;font-size:12px;max-width:200px"><strong>${person.name}</strong>${person.age ? `, ${person.age} años` : ""}<br/>${person.last_seen_location || ""}<br/><em style="color:#555">${person.contact_info || ""}</em></div>`);
      new mapboxgl.Marker({ element: el })
        .setLngLat([person.lng, person.lat])
        .setPopup(popup)
        .addTo(map.current!);
      missingMarkersRef.current.push(new mapboxgl.Marker({ element: el }));
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
    fetch(`${API}/missing-persons`).then((r) => r.json()).then((persons: MissingPerson[]) => {
      setMissingPersons(persons);
      renderMissingMarkers(persons);
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
    reliefMarkersRef.current.forEach(m => {
      const el = m.getElement();
      el.style.display = showRelief ? "flex" : "none";
    });
  }, [showRelief]);

  const sortedSelected = sortReports(selected, panelSort);

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-950 text-white">
      {/* USGS red alert projection — always visible */}
      <div className="bg-amber-950 border-b border-amber-800 px-4 py-1.5 flex items-center gap-3 flex-wrap shrink-0">
        <span className="text-amber-400 font-bold text-xs uppercase tracking-wide">⚠️ USGS Alerta Roja</span>
        <span className="text-amber-100 text-xs">Proyección de fatalidades: <strong>10,000 – 100,000</strong> víctimas estimadas</span>
        <a href="https://earthquake.usgs.gov/earthquakes/eventpage/us7000pjf8/pager" target="_blank" rel="noopener noreferrer"
          className="text-amber-500 text-xs hover:text-amber-300 ml-auto">Ver USGS PAGER →</a>
      </div>

      {/* Confirmed casualties */}
      <div className="bg-red-950 border-b border-red-800 px-4 py-2 flex items-center gap-4 flex-wrap shrink-0">
        <span className="text-red-300 font-bold text-sm uppercase tracking-wide">Víctimas confirmadas</span>
        <span className="text-white font-bold">
          {casualties?.deaths ?? 0} <span className="text-red-300 font-normal">muertos</span>
        </span>
        {casualties?.injured != null && (
          <span className="text-white font-bold">{casualties.injured} <span className="text-red-300 font-normal">heridos</span></span>
        )}
        {casualties?.missing != null && (
          <span className="text-white font-bold">{casualties.missing} <span className="text-red-300 font-normal">desaparecidos</span></span>
        )}
        <span className="text-red-500 text-xs ml-auto italic">
          {casualties?.source_name ?? "Cifra oficial pendiente de actualización"}
          {casualties?.scraped_at ? ` · ${timeAgo(casualties.scraped_at)}` : ""}
        </span>
      </div>
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0 flex-wrap gap-2">
        <div>
          <h1 className="font-bold text-red-400 text-lg leading-tight">🇻🇪 Venezuela Earthquake Map</h1>
          <p className="text-gray-400 text-xs">Reportes en tiempo real — daños y zonas afectadas</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {stats && (
            <span className="text-gray-400 text-xs">
              <span className="font-bold text-white">{stats.total}</span> reportes
              {stats.by_source && Object.entries(stats.by_source).map(([s, n]) => (
                <span key={s} className="ml-2 text-gray-500">{s}: {n}</span>
              ))}
            </span>
          )}

          {/* Source filter pills */}
          <div className="flex gap-1">
            {(["", "youtube", "twitter", "instagram"] as SourceFilter[]).map((s) => (
              <button key={s} onClick={() => setSource(s)}
                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  source === s
                    ? "bg-red-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}>
                {s === "" ? "Todas" : s === "twitter" ? "X / Twitter" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {/* Sort toggle */}
          <button onClick={() => setSort(s => s === "newest" ? "oldest" : "newest")}
            className="px-2 py-0.5 rounded text-xs bg-gray-800 text-gray-400 hover:bg-gray-700">
            {sort === "newest" ? "↓ Más recientes" : "↑ Más antiguos"}
          </button>

          <button onClick={() => setShowRelief(v => !v)}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              showRelief ? "bg-green-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}>
            📦 Acopios
          </button>

          <button onClick={() => { setShowMissing(true); setMissingStatus("idle"); }}
            className="px-2 py-0.5 rounded text-xs bg-orange-800 hover:bg-orange-700 text-white font-medium">
            🧍 Desaparecidos
          </button>

          <button onClick={() => { setShowSubmit(true); setSubmitStatus("idle"); }}
            className="px-3 py-0.5 rounded text-xs bg-red-700 hover:bg-red-600 text-white font-semibold">
            + Reportar daño
          </button>

          <button onClick={() => { setShowWalkthrough(true); setWalkthroughStep(0); }}
            className="w-6 h-6 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-bold flex items-center justify-center"
            title="¿Cómo usar el mapa?">
            ?
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        <div ref={mapRef} className="flex-1" />

        {selected.length > 0 && (
          <div className="absolute right-0 top-0 h-full w-96 bg-gray-900/95 border-l border-gray-800 overflow-y-auto z-10">
            <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-4 py-3">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-white text-sm">
                    📍 {selectedLocation ?? "Zona afectada"}
                  </p>
                  <p className="text-gray-400 text-xs">{selected.length} reporte{selected.length !== 1 ? "s" : ""}</p>
                </div>
                <button onClick={() => { setSelected([]); setSelectedLocation(null); }}
                  className="text-gray-500 hover:text-white text-xl leading-none">×</button>
              </div>
              <div className="flex gap-1 mt-2">
                <button onClick={() => setPanelSort("newest")}
                  className={`px-2 py-0.5 rounded text-xs ${panelSort === "newest" ? "bg-red-600 text-white" : "bg-gray-800 text-gray-400"}`}>
                  ↓ Más recientes
                </button>
                <button onClick={() => setPanelSort("oldest")}
                  className={`px-2 py-0.5 rounded text-xs ${panelSort === "oldest" ? "bg-red-600 text-white" : "bg-gray-800 text-gray-400"}`}>
                  ↑ Más antiguos
                </button>
              </div>
            </div>

            <div className="flex flex-col divide-y divide-gray-800">
              {sortedSelected.map((r) => (
                <div key={r.id} className={`p-4 flex flex-col gap-2 ${r.is_comment ? "bg-gray-950/60" : ""}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      {r.is_comment ? (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-gray-800 text-gray-400">
                          💬 comentario
                        </span>
                      ) : (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded uppercase ${
                          r.source === "twitter" ? "bg-blue-900 text-blue-300" :
                          r.source === "instagram" ? "bg-pink-900 text-pink-300" :
                          r.source === "web" ? "bg-green-900 text-green-300" :
                          "bg-red-900 text-red-300"
                        }`}>{r.source}</span>
                      )}
                      {r.credibility === "low" && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-500 border border-yellow-800">
                          baja confiabilidad
                        </span>
                      )}
                      {r.credibility === "high" && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-green-900/50 text-green-400 border border-green-800">
                          verificado
                        </span>
                      )}
                    </div>
                    {r.damage_level && (
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full" style={{ background: DAMAGE_COLOR[r.damage_level] }} />
                        <span className="text-xs text-gray-400">{DAMAGE_LABEL[r.damage_level]}</span>
                      </div>
                    )}
                  </div>

                  {r.text_content && (
                    <p className={`text-sm leading-relaxed ${r.is_comment ? "text-gray-400 italic" : "text-gray-300"}`}>
                      {r.text_content}
                    </p>
                  )}

                  {r.is_comment && r.parent_url && (
                    <a href={r.parent_url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-gray-600 hover:text-gray-400">
                      Ver video original →
                    </a>
                  )}

                  {!r.is_comment && r.media_urls?.length > 0 && (
                    <img src={r.media_urls[0]} alt="media"
                      className="rounded w-full object-cover max-h-40" />
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-gray-500 text-xs">
                      {r.author ? `@${r.author}` : ""}
                      {r.post_time ? ` · ${timeAgo(r.post_time)}` : ""}
                    </span>
                    <div className="flex items-center gap-2">
                      {!r.is_comment && (
                        <a href={r.source_url} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:text-blue-300">
                          Ver fuente →
                        </a>
                      )}
                      <button
                        title="Reportar como falso"
                        onClick={async () => {
                          if (flagged.has(r.id)) return;
                          await fetch(`${API}/reports/${r.id}`, { method: "POST" });
                          setFlagged(f => new Set(f).add(r.id));
                          setSelected(sel => sel.filter(s => s.id !== r.id || (s.flag_count ?? 0) < 2));
                        }}
                        className={`text-xs transition-colors ${flagged.has(r.id) ? "text-orange-400 cursor-default" : "text-gray-600 hover:text-orange-400"}`}>
                        {flagged.has(r.id) ? "🚩 reportado" : "🚩"}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="absolute bottom-8 left-4 flex flex-col gap-2 z-10">
          {/* Emergency numbers */}
          <div className="bg-red-950/95 border border-red-700 rounded p-3 text-xs flex flex-col gap-1.5">
            <p className="font-bold text-red-300 mb-0.5 uppercase tracking-wide">📞 Emergencias Venezuela</p>
            <div className="flex items-center justify-between gap-4">
              <span className="text-gray-400">Emergencia nacional</span>
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
          </div>

          {/* Damage legend */}
          <div className="bg-gray-900/90 rounded p-3 text-xs flex flex-col gap-1.5">
            <p className="font-semibold text-gray-300 mb-1">Nivel de daño</p>
            {Object.entries(DAMAGE_COLOR).map(([lvl, color]) => (
              <div key={lvl} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ background: color }} />
                <span className="text-gray-400">{DAMAGE_LABEL[Number(lvl)]}</span>
              </div>
            ))}
            <div className="border-t border-gray-700 mt-1 pt-1.5 flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-gray-400">Centro de acopio</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500" />
              <span className="text-gray-400">Desaparecido</span>
            </div>
          </div>
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
                    fetch(`${API}/missing-persons`).then(r => r.json()).then((persons: MissingPerson[]) => {
                      setMissingPersons(persons);
                      renderMissingMarkers(persons);
                    }).catch(() => {});
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
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-sm p-6 flex flex-col gap-5">
            <div className="flex justify-between items-center">
              <span className="text-gray-500 text-xs">{walkthroughStep + 1} / {WALKTHROUGH_STEPS.length}</span>
              <button onClick={() => setShowWalkthrough(false)} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
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
                <button onClick={() => setShowWalkthrough(false)}
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
