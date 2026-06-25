"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

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

export default function Home() {
  const mapRef = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [selected, setSelected] = useState<Report | null>(null);
  const [stats, setStats] = useState<{ total: number; by_source: Record<string, number> } | null>(null);
  const [source, setSource] = useState<string>("");

  function loadData() {
    const params = source ? `?source=${source}` : "";
    Promise.all([
      fetch(`${API}/reports/geojson${params}`).then((r) => r.json()),
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
          "heatmap-weight": ["interpolate", ["linear"], ["get", "damage_level"], 1, 0.2, 5, 1],
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

      m.on("click", "reports-points", (e) => {
        const props = e.features?.[0]?.properties;
        if (props) {
          setSelected({ ...props, media_urls: JSON.parse(props.media_urls ?? "[]") } as Report);
        }
      });
      m.on("mouseenter", "reports-points", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "reports-points", () => { m.getCanvas().style.cursor = ""; });
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
  }, [source]);

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-950 text-white">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0">
        <div>
          <h1 className="font-bold text-red-400 text-lg leading-tight">🇻🇪 Venezuela Earthquake Map</h1>
          <p className="text-gray-400 text-xs">Reportes en tiempo real — daños y zonas afectadas</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {stats && (
            <span className="text-gray-300">
              <span className="font-bold text-white">{stats.total}</span> reportes
            </span>
          )}
          <select
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">Todas las fuentes</option>
            <option value="twitter">Twitter / X</option>
            <option value="instagram">Instagram</option>
            <option value="youtube">YouTube</option>
          </select>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        <div ref={mapRef} className="flex-1" />

        {selected && (
          <div className="absolute right-0 top-0 h-full w-80 bg-gray-900/95 border-l border-gray-800 overflow-y-auto p-4 flex flex-col gap-3 z-10">
            <div className="flex justify-between items-start">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded uppercase ${
                selected.source === "twitter" ? "bg-blue-900 text-blue-300" :
                selected.source === "instagram" ? "bg-pink-900 text-pink-300" :
                "bg-red-900 text-red-300"
              }`}>{selected.source}</span>
              <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
            </div>
            {selected.location_name && <p className="text-white font-semibold text-sm">📍 {selected.location_name}</p>}
            {selected.damage_level && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Severidad</span>
                <div className="flex gap-1">
                  {[1,2,3,4,5].map(n => (
                    <div key={n} className="w-4 h-4 rounded-sm" style={{
                      background: n <= selected.damage_level ? DAMAGE_COLOR[selected.damage_level] : "#374151"
                    }} />
                  ))}
                </div>
                <span className="text-xs text-gray-400">{DAMAGE_LABEL[selected.damage_level]}</span>
              </div>
            )}
            {selected.text_content && <p className="text-gray-300 text-sm leading-relaxed">{selected.text_content}</p>}
            {selected.media_urls?.length > 0 && (
              <div className="flex flex-col gap-2">
                {selected.media_urls.map((url, i) => (
                  <img key={i} src={url} alt="media" className="rounded w-full object-cover max-h-48" />
                ))}
              </div>
            )}
            {selected.author && <p className="text-gray-500 text-xs">Por @{selected.author}</p>}
            {selected.post_time && <p className="text-gray-500 text-xs">{new Date(selected.post_time).toLocaleString("es-VE")}</p>}
            <a href={selected.source_url} target="_blank" rel="noopener noreferrer"
              className="text-center text-xs bg-gray-800 hover:bg-gray-700 rounded py-2 text-blue-400">
              Ver publicación original →
            </a>
          </div>
        )}

        <div className="absolute bottom-8 left-4 bg-gray-900/90 rounded p-3 text-xs flex flex-col gap-1.5 z-10">
          <p className="font-semibold text-gray-300 mb-1">Nivel de daño</p>
          {Object.entries(DAMAGE_COLOR).map(([lvl, color]) => (
            <div key={lvl} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ background: color }} />
              <span className="text-gray-400">{DAMAGE_LABEL[Number(lvl)]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
