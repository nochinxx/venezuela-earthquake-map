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
  const [selected, setSelected] = useState<Report[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
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

      m.on("click", "reports-points", async (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const [lng, lat] = (feat.geometry as GeoJSON.Point).coordinates;
        const loc = feat.properties?.location_name ?? null;
        setSelectedLocation(loc);
        const res = await fetch(`${API}/reports/nearby?lat=${lat}&lng=${lng}&radius_km=20`);
        const rows: Report[] = await res.json();
        setSelected(rows.map(r => ({ ...r, media_urls: Array.isArray(r.media_urls) ? r.media_urls : [] })));
      });

      m.on("click", "reports-clusters", (e) => {
        const feat = e.features?.[0];
        if (!feat || !map.current) return;
        const clusterId = feat.properties?.cluster_id;
        const src = map.current.getSource("reports") as mapboxgl.GeoJSONSource;
        src.getClusterLeaves(clusterId, 100, 0, async (_err, leaves) => {
          if (!leaves?.length) return;
          const [lng, lat] = (leaves[0].geometry as GeoJSON.Point).coordinates;
          setSelectedLocation(leaves[0].properties?.location_name ?? null);
          const res = await fetch(`${API}/reports/nearby?lat=${lat}&lng=${lng}&radius_km=30`);
          const rows: Report[] = await res.json();
          setSelected(rows.map(r => ({ ...r, media_urls: Array.isArray(r.media_urls) ? r.media_urls : [] })));
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

        {selected.length > 0 && (
          <div className="absolute right-0 top-0 h-full w-96 bg-gray-900/95 border-l border-gray-800 overflow-y-auto z-10">
            <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-4 py-3 flex justify-between items-center">
              <div>
                <p className="font-semibold text-white text-sm">
                  📍 {selectedLocation ?? "Zona afectada"}
                </p>
                <p className="text-gray-400 text-xs">{selected.length} reporte{selected.length !== 1 ? "s" : ""}</p>
              </div>
              <button onClick={() => { setSelected([]); setSelectedLocation(null); }}
                className="text-gray-500 hover:text-white text-xl leading-none">×</button>
            </div>

            <div className="flex flex-col divide-y divide-gray-800">
              {selected.map((r) => (
                <div key={r.id} className="p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded uppercase ${
                      r.source === "twitter" ? "bg-blue-900 text-blue-300" :
                      r.source === "instagram" ? "bg-pink-900 text-pink-300" :
                      "bg-red-900 text-red-300"
                    }`}>{r.source}</span>
                    {r.damage_level && (
                      <div className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full" style={{ background: DAMAGE_COLOR[r.damage_level] }} />
                        <span className="text-xs text-gray-400">{DAMAGE_LABEL[r.damage_level]}</span>
                      </div>
                    )}
                  </div>

                  {r.text_content && (
                    <p className="text-gray-300 text-sm leading-relaxed">{r.text_content}</p>
                  )}

                  {r.media_urls?.length > 0 && (
                    <img src={r.media_urls[0]} alt="media"
                      className="rounded w-full object-cover max-h-40" />
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-gray-500 text-xs">
                      {r.author ? `@${r.author}` : ""}
                      {r.post_time ? ` · ${new Date(r.post_time).toLocaleDateString("es-VE")}` : ""}
                    </span>
                    <a href={r.source_url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300">
                      Ver fuente →
                    </a>
                  </div>
                </div>
              ))}
            </div>
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
