"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Person {
  id: string;
  name: string;
  age?: number | null;
  last_seen_location?: string | null;
  description?: string | null;
  status: string;
  external_source?: string | null;
  source2_url?: string | null;
  submitted_at?: string | null;
}

function tweetLabel(url: string | null | undefined): string {
  if (!url) return "Fuente desconocida";
  const m = url.match(/x\.com\/([^/]+)\/status\//);
  return m ? `@${m[1]}` : url;
}

function sourceTitle(src: string | null | undefined): string {
  if (!src) return "Cruce de datos";
  if (src.includes("Domingo Luciani")) return "Lista de pacientes — Hospital Domingo Luciani";
  if (src.includes("Vargas")) return "Lista de pacientes — Hospital Dr. José María Vargas";
  if (src.includes("Perez Carreño")) return "Lista de pacientes — Hospital Pérez Carreño";
  return src.replace("@mariojllesca via ", "").replace("@mariojllesca — cruce con ", "");
}

export default function LocalizadosPage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`${API}/missing-persons?matched=1&limit=200`)
      .then(r => r.json())
      .then((res: { data: Person[] }) => {
        setPeople(res.data ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Group by source tweet URL
  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; title: string; people: Person[] }>();
    for (const p of people) {
      const key = p.source2_url ?? "manual";
      if (!map.has(key)) {
        map.set(key, {
          label: tweetLabel(p.source2_url),
          title: sourceTitle(p.external_source),
          people: [],
        });
      }
      map.get(key)!.people.push(p);
    }
    return Array.from(map.values());
  }, [people]);

  const filtered = useMemo(() => {
    if (!q.trim()) return grouped;
    const ql = q.toLowerCase();
    return grouped.map(g => ({
      ...g,
      people: g.people.filter(p =>
        p.name.toLowerCase().includes(ql) ||
        (p.last_seen_location ?? "").toLowerCase().includes(ql)
      ),
    })).filter(g => g.people.length > 0);
  }, [grouped, q]);

  function copyAll() {
    const lines = grouped.flatMap(g => [
      `\n📋 ${g.title} (${g.label})`,
      ...g.people.map(p => `  • ${p.name}${p.last_seen_location ? ` — ${p.last_seen_location}` : ""}`),
    ]);
    navigator.clipboard.writeText(
      `Personas localizadas por cruce de datos @mariojllesca — SismoVenezuela\n${lines.join("\n")}\n\nFuente del mapa: https://sismovenezuela.vercel.app/localizados`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link href="/"
            className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm transition-colors shrink-0">
            ← Volver al mapa
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={copyAll}
              className="px-3 py-1.5 rounded bg-cyan-800 hover:bg-cyan-700 text-cyan-100 text-xs font-semibold transition-colors">
              {copied ? "✓ Copiado" : "Copiar lista"}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-6">

        {/* Hero */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-white">Personas localizadas</h1>
            {!loading && (
              <span className="px-2.5 py-0.5 rounded-full bg-green-900 text-green-300 text-sm font-bold">
                {people.length} localizados
              </span>
            )}
          </div>
          <p className="text-gray-400 text-sm leading-relaxed">
            Personas confirmadas mediante <strong className="text-cyan-400">cruce de datos por @mariojllesca</strong> — comparando listas publicadas desde hospitales y fuentes oficiales contra los registros de desaparecidos de{" "}
            <a href="https://desaparecidosterremotovenezuela.com" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline">desaparecidosterremotovenezuela.com</a>
            {" y "}
            <a href="https://venezulatebusca.com" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline">venezulatebusca.com</a>.
          </p>
          <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
            <span>🔍 Método: comparación automática de nombres (Jaccard + SequenceMatcher)</span>
            <span>·</span>
            <span>⚠️ Los cruces son aproximados — siempre verificar con la fuente</span>
          </div>
        </div>

        {/* Search */}
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar por nombre o lugar..."
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
        />

        {/* Loading */}
        {loading && (
          <div className="text-center text-gray-600 py-12">Cargando...</div>
        )}

        {/* Groups */}
        {!loading && filtered.length === 0 && (
          <div className="text-center text-gray-600 py-12 text-sm">Sin resultados</div>
        )}

        {!loading && filtered.map((group, gi) => (
          <div key={gi} className="flex flex-col gap-3">
            {/* Group header */}
            <div className="flex items-start justify-between gap-3 border-b border-gray-800 pb-2">
              <div>
                <p className="text-white font-semibold text-sm">{group.title}</p>
                {group.label !== "Fuente desconocida" && (
                  <a
                    href={grouped[gi]?.people[0]?.source2_url ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-500 text-xs hover:underline"
                  >
                    {group.label} — ver tweet fuente ↗
                  </a>
                )}
              </div>
              <span className="text-gray-500 text-xs shrink-0">{group.people.length} persona{group.people.length !== 1 ? "s" : ""}</span>
            </div>

            {/* People cards */}
            <div className="flex flex-col gap-2">
              {group.people.map((p, pi) => (
                <div key={pi} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-900/60 border border-green-700 flex items-center justify-center text-green-400 text-sm shrink-0 mt-0.5">
                    ✓
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <p className="font-semibold text-white text-sm">{p.name}</p>
                    {p.age && <p className="text-gray-500 text-xs">{p.age} años</p>}
                    {p.last_seen_location && (
                      <p className="text-gray-400 text-xs">📍 {p.last_seen_location}</p>
                    )}
                    <p className="text-cyan-400 text-[10px] font-medium mt-0.5">🔍 Cruce de datos por @mariojllesca</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Footer */}
        {!loading && people.length > 0 && (
          <div className="border-t border-gray-800 pt-4 flex flex-col gap-3">
            <p className="text-gray-600 text-xs text-center">
              Si encontrás un error en el cruce,{" "}
              <a href="https://github.com/nochinxx/venezuela-earthquake-map/issues" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-white">
                abrí un issue en GitHub
              </a>
              {" "}o contactá a{" "}
              <a href="https://x.com/mariojllesca" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-white">
                @mariojllesca
              </a>
            </p>
            <div className="flex justify-center">
              <button onClick={copyAll}
                className="px-4 py-2 rounded-lg bg-cyan-900 hover:bg-cyan-800 text-cyan-200 text-sm font-semibold transition-colors">
                {copied ? "✓ Lista copiada al portapapeles" : "Copiar lista completa para compartir"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
