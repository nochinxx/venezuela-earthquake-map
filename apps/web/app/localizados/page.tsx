"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";


interface Person {
  id: string;
  name: string;
  age?: number | null;
  last_seen_location?: string | null;
  description?: string | null;
  status: string;
  external_source?: string | null;
  source2_url?: string | null;
  source_id?: string | null;
  submitted_at?: string | null;
}

type Tab = "matched" | "all";

function tweetLabel(url: string | null | undefined): string {
  if (!url) return "Fuente desconocida";
  const m = url.match(/x\.com\/([^/]+)\/status\//);
  return m ? `@${m[1]}` : url;
}

function sourceTitle(src: string | null | undefined): string {
  if (!src) return "Cruce de datos";
  if (src.includes("Domingo Luciani")) return "Lista de pacientes — Hospital Domingo Luciani";
  if (src.includes("Vargas")) return "Lista de pacientes — Hospital Dr. José María Vargas";
  if (src.includes("Pérez Carreño") || src.includes("Perez Carreño")) return "Lista de pacientes — Hospital Pérez Carreño";
  return src.replace("SismoVenezuela via ", "").replace("SismoVenezuela — cruce con lista de pacientes del ", "").trim();
}

function sourceBadge(src: string | null | undefined): string {
  if (!src) return "desconocida";
  if (src.includes("desaparecidos-vzla") || src.includes("desaparecidoster")) return "desaparecidosterremotovenezuela.com";
  if (src.includes("venezulatebusca")) return "venezulatebusca.com";
  if (src.includes("SismoVenezuela")) return "SismoVenezuela";
  return src;
}

export default function LocalizadosPage() {
  const [tab, setTab] = useState<Tab>("matched");
  const [matched, setMatched] = useState<Person[]>([]);
  const [all, setAll] = useState<Person[]>([]);
  const [loadingMatched, setLoadingMatched] = useState(true);
  const [loadingAll, setLoadingAll] = useState(false);
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Load matched (our cross-references) on mount
  useEffect(() => {
    fetch(`/api/missing-persons?matched=1&limit=500`)
      .then(r => r.json())
      .then((res: { data: Person[] }) => { setMatched(res.data ?? []); setLoadingMatched(false); })
      .catch(() => setLoadingMatched(false));
  }, []);

  // Load all localizados lazily when tab switches
  useEffect(() => {
    if (tab !== "all" || all.length > 0) return;
    setLoadingAll(true);
    fetch(`/api/missing-persons?status=encontrado&limit=500`)
      .then(r => r.json())
      .then((res: { data: Person[] }) => { setAll(res.data ?? []); setLoadingAll(false); })
      .catch(() => setLoadingAll(false));
  }, [tab, all.length]);

  const people = tab === "matched" ? matched : all;
  const loading = tab === "matched" ? loadingMatched : loadingAll;

  // For matched tab: only confirmed DB matches (had a prior missing report)
  const confirmedMatched = useMemo(() => matched.filter(p => p.source_id), [matched]);

  // Group by source tweet
  const groupedMatched = useMemo(() => {
    const map = new Map<string, { label: string; title: string; tweetUrl: string | null; people: Person[] }>();
    for (const p of confirmedMatched) {
      const key = p.source2_url ?? "manual";
      if (!map.has(key)) {
        map.set(key, {
          label: tweetLabel(p.source2_url),
          title: sourceTitle(p.external_source),
          tweetUrl: p.source2_url ?? null,
          people: [],
        });
      }
      map.get(key)!.people.push(p);
    }
    return Array.from(map.values());
  }, [matched]);

  const ql = q.toLowerCase().trim();

  const filteredGroups = useMemo(() => {
    if (!ql) return groupedMatched;
    return groupedMatched
      .map(g => ({ ...g, people: g.people.filter(p => p.name.toLowerCase().includes(ql) || (p.last_seen_location ?? "").toLowerCase().includes(ql)) }))
      .filter(g => g.people.length > 0);
  }, [groupedMatched, ql]);

  const filteredAll = useMemo(() => {
    if (!ql) return all;
    return all.filter(p => p.name.toLowerCase().includes(ql) || (p.last_seen_location ?? "").toLowerCase().includes(ql));
  }, [all, ql]);

  function copyAll() {
    let text = `Personas localizadas — SismoVenezuela\n`;
    if (tab === "matched") {
      text += `Cruce de datos contra listas hospitalarias\n`;
      groupedMatched.forEach(g => {
        text += `\n📋 ${g.title}${g.tweetUrl ? ` (${g.label} → ${g.tweetUrl})` : ""}\n`;
        g.people.forEach(p => { text += `  • ${p.name}${p.last_seen_location ? ` — ${p.last_seen_location}` : ""}\n`; });
      });
    } else {
      text += `Todos los localizados (${all.length})\n`;
      all.forEach(p => { text += `  • ${p.name}${p.last_seen_location ? ` — ${p.last_seen_location}` : ""}\n`; });
    }
    text += `\nhttps://sismovenezuela.vercel.app/localizados`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Sticky header */}
      <div className="bg-gray-900 border-b border-gray-800 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-1.5 text-gray-400 hover:text-white text-sm transition-colors shrink-0">
            ← Mapa
          </Link>
          <span className="text-white font-semibold text-sm truncate">Personas localizadas</span>
          <button onClick={copyAll}
            className="px-3 py-1.5 rounded bg-cyan-800 hover:bg-cyan-700 text-cyan-100 text-xs font-semibold transition-colors shrink-0">
            {copied ? "✓ Copiado" : "Copiar lista"}
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5 flex flex-col gap-5">

        {/* Tabs + count */}
        <div className="flex flex-col gap-3">
          <div className="flex gap-1 p-1 bg-gray-900 rounded-lg border border-gray-800">
            <button
              onClick={() => setTab("matched")}
              className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${tab === "matched" ? "bg-cyan-900 text-cyan-200" : "text-gray-500 hover:text-gray-300"}`}>
              🔍 Cruce SismoVenezuela
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${tab === "matched" ? "bg-cyan-700 text-cyan-100" : "bg-gray-800 text-gray-500"}`}>
                {confirmedMatched.length}
              </span>
            </button>
            <button
              onClick={() => setTab("all")}
              className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${tab === "all" ? "bg-green-900 text-green-200" : "text-gray-500 hover:text-gray-300"}`}>
              ✓ Todos los localizados
              {all.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${tab === "all" ? "bg-green-700 text-green-100" : "bg-gray-800 text-gray-500"}`}>
                  {all.length}
                </span>
              )}
            </button>
          </div>

          {/* Tab description */}
          {tab === "matched" ? (
            <div className="flex flex-col gap-2">
              <p className="text-gray-400 text-xs leading-relaxed">
                Personas confirmadas mediante <strong className="text-cyan-400">cruce de listas hospitalarias</strong> por SismoVenezuela, comparadas contra los registros de{" "}
                <a href="https://desaparecidosterremotovenezuela.com" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline">desaparecidosterremotovenezuela.com</a>
                {" y "}
                <a href="https://venezulatebusca.com" target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline">venezulatebusca.com</a>.
              </p>

              {/* Methodology toggle */}
              <button
                onClick={() => setShowMethod(v => !v)}
                className="flex items-center gap-1.5 text-gray-500 hover:text-gray-300 text-[11px] transition-colors w-fit">
                <span className={`transition-transform ${showMethod ? "rotate-90" : ""}`}>▶</span>
                {showMethod ? "Ocultar metodología" : "¿Cómo funciona el cruce? · Margen de error"}
              </button>

              {showMethod && (
                <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 flex flex-col gap-2.5 text-xs">
                  <div>
                    <p className="text-gray-200 font-semibold mb-1">Metodología</p>
                    <p className="text-gray-400 leading-relaxed">
                      Tomamos listas de pacientes publicadas en hospitales (vía X/Twitter) y las comparamos automáticamente contra la base de datos de desaparecidos. El algoritmo calcula un <strong className="text-cyan-400">score de similitud de nombre</strong> usando coincidencia de caracteres (<em>SequenceMatcher</em>) combinado con solapamiento de palabras clave. Solo se registra el cruce si el score supera el <strong className="text-cyan-400">72 %</strong> de similitud.
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-200 font-semibold mb-1">Confianza por nivel</p>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-400 shrink-0"></span>
                        <span className="text-gray-400"><strong className="text-gray-300">≥ 85 %</strong> — alta confianza: nombre prácticamente idéntico, variaciones menores de ortografía</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-yellow-400 shrink-0"></span>
                        <span className="text-gray-400"><strong className="text-gray-300">72 – 84 %</strong> — confianza media: posible variación de apellido, nombre abreviado, o error tipográfico en la fuente</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-gray-200 font-semibold mb-1">Limitaciones</p>
                    <ul className="text-gray-400 leading-relaxed list-disc list-inside space-y-0.5">
                      <li>Puede haber <strong className="text-yellow-400">falsos positivos</strong> si dos personas comparten nombre similar</li>
                      <li>Puede haber <strong className="text-yellow-400">falsos negativos</strong> si el nombre en la lista hospitalaria difiere mucho del registrado</li>
                      <li>Las listas hospitalarias pueden contener errores tipográficos en el nombre original</li>
                    </ul>
                  </div>
                  <p className="text-gray-600 text-[10px] border-t border-gray-800 pt-2">
                    ⚠️ Todos los cruces son aproximados. <strong className="text-gray-500">Verificar siempre con la fuente original</strong> (ver enlace al tweet) antes de confirmar y actualizar registros.
                  </p>
                </div>
              )}

              <p className="text-gray-600 text-[10px]">⚠️ Los cruces son aproximados — siempre verificar con la fuente original antes de confirmar.</p>
            </div>
          ) : (
            <p className="text-gray-400 text-xs leading-relaxed">
              Todos los registros con estado <strong className="text-green-400">localizado / encontrado</strong> en nuestra base de datos, de cualquier fuente — nuestro cruce, actualizaciones de plataformas colaboradoras y reportes directos.
            </p>
          )}
        </div>

        {/* Search */}
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar por nombre o lugar..."
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
        />

        {/* Loading */}
        {loading && <div className="text-center text-gray-600 py-12 text-sm">Cargando...</div>}

        {/* Matched tab — grouped by source */}
        {!loading && tab === "matched" && (
          <>
            {filteredGroups.length === 0 && <div className="text-center text-gray-600 py-12 text-sm">Sin resultados</div>}
            {filteredGroups.map((group, gi) => (
              <div key={gi} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3 border-b border-gray-800 pb-2">
                  <div className="flex flex-col gap-0.5">
                    <p className="text-white font-semibold text-sm">{group.title}</p>
                    {group.tweetUrl && (
                      <a href={group.tweetUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-500 text-xs hover:underline">
                        {group.label} — ver tweet fuente ↗
                      </a>
                    )}
                  </div>
                  <span className="text-gray-500 text-xs shrink-0">{group.people.length} persona{group.people.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {group.people.map((p, pi) => {
                    const isExpanded = expandedId === p.id;
                    const apiUrl = `https://desaparecidosterremotovenezuela.com/?persona=${p.source_id}`;
                    return (
                      <div key={pi} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                        {/* Clickable header row */}
                        <button
                          className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-gray-800/40 transition-colors"
                          onClick={() => setExpandedId(isExpanded ? null : p.id)}>
                          <div className="w-8 h-8 rounded-full bg-cyan-900/60 border border-cyan-700 flex items-center justify-center text-cyan-400 text-sm shrink-0 mt-0.5">✓</div>
                          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                            <p className="font-semibold text-white text-sm">{p.name}</p>
                            {p.age && <p className="text-gray-500 text-xs">{p.age} años</p>}
                            {p.last_seen_location && <p className="text-gray-400 text-xs">📍 {p.last_seen_location}</p>}
                          </div>
                          <span className="text-gray-600 text-xs shrink-0 mt-1">{isExpanded ? "▲" : "▼"}</span>
                        </button>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div className="px-4 pb-3 flex flex-col gap-2 border-t border-gray-800">
                            {p.description && (
                              <p className="text-gray-400 text-xs mt-2 leading-relaxed">{p.description}</p>
                            )}
                            <div className="flex flex-col gap-1.5 mt-1">
                              {/* Missing report source */}
                              <div className="flex flex-col gap-0.5">
                                <p className="text-gray-600 text-[10px] uppercase tracking-wide">Reporte de desaparecido</p>
                                <a href={apiUrl} target="_blank" rel="noopener noreferrer"
                                  className="text-violet-400 text-xs hover:text-violet-200 hover:underline">
                                  📋 Ver ficha en desaparecidosterremotovenezuela.com ↗
                                </a>
                              </div>
                              {/* Hospital confirmation */}
                              <div className="flex flex-col gap-0.5">
                                <p className="text-gray-600 text-[10px] uppercase tracking-wide">Confirmación hospitalaria</p>
                                {p.source2_url
                                  ? <a href={p.source2_url} target="_blank" rel="noopener noreferrer"
                                      className="text-cyan-500 text-xs hover:text-cyan-300 hover:underline">
                                      🏥 {group.title} ↗
                                    </a>
                                  : <p className="text-cyan-400 text-xs">🏥 {group.title}</p>
                                }
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}

        {/* All tab — flat list */}
        {!loading && tab === "all" && (
          <>
            {filteredAll.length === 0 && <div className="text-center text-gray-600 py-12 text-sm">Sin resultados</div>}
            <div className="flex flex-col gap-2">
              {filteredAll.map((p, i) => {
                const byUs = String(p.external_source ?? "").includes("SismoVenezuela");
                const badge = sourceBadge(p.external_source);
                return (
                  <div key={i} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-sm shrink-0 mt-0.5 ${byUs ? "bg-cyan-900/60 border-cyan-700 text-cyan-400" : "bg-green-900/60 border-green-700 text-green-400"}`}>✓</div>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <p className="font-semibold text-white text-sm">{p.name}</p>
                      {p.age && <p className="text-gray-500 text-xs">{p.age} años</p>}
                      {p.last_seen_location && <p className="text-gray-400 text-xs">📍 {p.last_seen_location}</p>}
                      <div className="flex flex-col gap-1 mt-1">
                        {byUs
                          ? <p className="text-cyan-400 text-[10px] font-medium">🔍 Cruce SismoVenezuela</p>
                          : (() => {
                              const isDesap = String(p.external_source ?? "").includes("desaparecidos");
                              const personUrl = isDesap && p.source_id
                                ? `https://desaparecidosterremotovenezuela.com/?persona=${p.source_id}`
                                : isDesap ? "https://desaparecidosterremotovenezuela.com" : "https://venezulatebusca.com";
                              return (
                                <a href={personUrl} target="_blank" rel="noopener noreferrer"
                                  className="text-green-500 text-[10px] hover:text-green-300 hover:underline">
                                  📋 {p.source_id ? `Ver ficha en ${badge}` : badge} ↗
                                </a>
                              );
                            })()
                        }
                        {p.source2_url && (
                          <a href={p.source2_url} target="_blank" rel="noopener noreferrer"
                            className={`text-xs font-medium hover:underline ${byUs ? "text-cyan-500 hover:text-cyan-300" : "text-blue-400 hover:text-blue-200"}`}>
                            Ver reporte original ↗
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Footer */}
        {!loading && people.length > 0 && (
          <div className="border-t border-gray-800 pt-4 flex flex-col gap-3">
            <div className="flex justify-center">
              <button onClick={copyAll}
                className="px-4 py-2 rounded-lg bg-cyan-900 hover:bg-cyan-800 text-cyan-200 text-sm font-semibold transition-colors">
                {copied ? "✓ Lista copiada" : "Copiar lista completa"}
              </button>
            </div>
            <p className="text-gray-600 text-xs text-center">
              Error en el cruce →{" "}
              <a href="https://github.com/nochinxx/venezuela-earthquake-map/issues" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400">GitHub</a>
              {" · "}
              <a href="https://x.com/mariojllesca" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400">@mariojllesca</a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
