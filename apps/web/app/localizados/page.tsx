"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";


interface Person {
  id: string;
  name: string;
  age?: number | null;
  last_seen_location?: string | null;
  description?: string | null;
  contact_info?: string | null;
  photo_url?: string | null;
  status: string;
  external_source?: string | null;
  source2_url?: string | null;
  source_id?: string | null;
  submitted_at?: string | null;
}

type Tab = "matched" | "all" | "listas";

function tweetLabel(url: string | null | undefined): string {
  if (!url) return "Fuente desconocida";
  const m = url.match(/x\.com\/([^/]+)\/status\//);
  return m ? `@${m[1]}` : url;
}

function sourceTitle(src: string | null | undefined): string {
  if (!src) return "Cruce de datos";
  const stripped = src.replace(/^SismoVenezuela(?::[a-z]+)? via /i, "").replace("SismoVenezuela — cruce con lista de pacientes del ", "").trim();
  if (stripped.includes("Domingo Luciani")) return "Lista de pacientes — Hospital Domingo Luciani";
  if (stripped.includes("Vargas")) return "Lista de pacientes — Hospital Dr. José María Vargas";
  if (stripped.includes("Pérez Carreño") || stripped.includes("Perez Carreño")) return "Lista de pacientes — Hospital Pérez Carreño";
  if (stripped.includes("Consolidado") || stripped.includes("mariangelli")) return "Listado hospitalario consolidado — múltiples hospitales Caracas";
  return stripped || "Cruce de datos";
}

function sourceBadge(src: string | null | undefined): string {
  if (!src) return "desconocida";
  if (src.includes("desaparecidos-vzla") || src.includes("desaparecidoster")) return "desaparecidosterremotovenezuela.com";
  if (src.includes("venezulatebusca")) return "venezulatebusca.com";
  if (src.includes("SismoVenezuela")) return "SismoVenezuela";
  return src;
}

function matchCircle(src: string | null | undefined, inDb: boolean): { circle: string; label: string } {
  if (!inDb) return { circle: "⚫️", label: "Nueva entrada desde lista hospitalaria" };
  if (src?.includes(":cedula")) return { circle: "🟢", label: "Cédula verificada" };
  if (src?.includes(":high")) return { circle: "🟡", label: "Alta confianza — nombre ≥85%" };
  if (src?.includes(":medium")) return { circle: "🟠", label: "Confianza media — nombre 72–84%" };
  return { circle: "🟡", label: "Alta confianza (cruce anterior)" };
}

export default function LocalizadosPage() {
  const [tab, setTab] = useState<Tab>("matched");
  const [matched, setMatched] = useState<Person[]>([]);
  const [all, setAll] = useState<Person[]>([]);
  const [loadingMatched, setLoadingMatched] = useState(true);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [allTotal, setAllTotal] = useState<number | null>(null);
  const [matchedTotal, setMatchedTotal] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedList, setExpandedList] = useState<string | null>(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitForm, setSubmitForm] = useState({ submitter: "", hospital: "", tweetUrl: "", names: "" });
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitDone, setSubmitDone] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [sinContactoTotal, setSinContactoTotal] = useState<number | null>(null);

  // Load matched cross-references + background counts on mount
  useEffect(() => {
    fetch(`/api/missing-persons?matched=1&limit=500`)
      .then(r => r.json())
      .then((res: { data: Person[]; total: number }) => {
        setMatched(res.data ?? []);
        setMatchedTotal(res.total ?? 0);
        setLoadingMatched(false);
      })
      .catch(() => setLoadingMatched(false));

    fetch("/api/missing-persons?count=1&status=sin-contacto")
      .then(r => r.json())
      .then((res: { total: number }) => setSinContactoTotal(res.total ?? null))
      .catch(() => {});

    fetch("/api/missing-persons?count=1&status=encontrado")
      .then(r => r.json())
      .then((res: { total: number }) => setAllTotal(res.total ?? null))
      .catch(() => {});
  }, []);

  // Load all localizados lazily when tab switches
  useEffect(() => {
    if ((tab !== "all" && tab !== "listas") || all.length > 0) return;
    setLoadingAll(true);
    fetch(`/api/missing-persons?status=encontrado&limit=500&offset=0`)
      .then(r => r.json())
      .then((res: { data: Person[]; total: number }) => {
        setAll(res.data ?? []);
        setAllTotal(res.total ?? 0);
        setLoadingAll(false);
      })
      .catch(() => setLoadingAll(false));
  }, [tab, all.length]);

  function loadMore() {
    setLoadingMore(true);
    fetch(`/api/missing-persons?status=encontrado&limit=500&offset=${all.length}`)
      .then(r => r.json())
      .then((res: { data: Person[]; total: number }) => {
        setAll(prev => [...prev, ...(res.data ?? [])]);
        setAllTotal(res.total ?? 0);
        setLoadingMore(false);
      })
      .catch(() => setLoadingMore(false));
  }

  const allHasMore = allTotal != null && all.length < allTotal;
  const people = tab === "matched" ? matched : all;
  const loading = tab === "matched" ? loadingMatched : loadingAll;

  const confirmedMatched = useMemo(() => matched.filter(p => p.source_id), [matched]);

  // Group ALL matched records (confirmed + new inserts) by source tweet for inline stats
  const groupedAllMatched = useMemo(() => {
    const map = new Map<string, { label: string; title: string; tweetUrl: string | null; total: number; confirmed: number }>();
    for (const p of matched) {
      const key = p.source2_url ?? "manual";
      if (!map.has(key)) {
        map.set(key, {
          label: tweetLabel(p.source2_url),
          title: sourceTitle(p.external_source),
          tweetUrl: p.source2_url ?? null,
          total: 0,
          confirmed: 0,
        });
      }
      const g = map.get(key)!;
      g.total++;
      if (p.source_id) g.confirmed++;
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [matched]);

  // Group confirmed matches by source tweet for matched tab display
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

  const groupedByList = useMemo(() => {
    const map = new Map<string, { label: string; title: string; tweetUrl: string; people: Person[] }>();
    for (const p of all) {
      if (!p.source2_url) continue;
      if (!p.source2_url.includes("x.com") && !p.source2_url.includes("twitter.com")) continue;
      if (!map.has(p.source2_url)) {
        map.set(p.source2_url, {
          label: tweetLabel(p.source2_url),
          title: sourceTitle(p.external_source),
          tweetUrl: p.source2_url,
          people: [],
        });
      }
      map.get(p.source2_url)!.people.push(p);
    }
    return Array.from(map.values()).sort((a, b) => b.people.length - a.people.length);
  }, [all]);

  const filteredLists = useMemo(() => {
    if (!ql) return groupedByList;
    return groupedByList
      .map(g => ({ ...g, people: g.people.filter(p => p.name.toLowerCase().includes(ql)) }))
      .filter(g => g.people.length > 0);
  }, [groupedByList, ql]);

  function copyAll() {
    let text = `Personas localizadas — SismoVenezuela\nhttps://sismovenezuela.vercel.app/localizados\n`;
    if (tab === "matched") {
      text += `\nCruce de datos contra listas hospitalarias\n`;
      groupedMatched.forEach(g => {
        text += `\n📋 ${g.title}${g.tweetUrl ? ` (${g.label} → ${g.tweetUrl})` : ""}\n`;
        g.people.forEach(p => { text += `  • ${p.name}${p.last_seen_location ? ` — ${p.last_seen_location}` : ""}\n`; });
      });
    } else if (tab === "listas") {
      text += `\nListas de pacientes hospitalarios\n`;
      groupedByList.forEach(g => {
        text += `\n📋 ${g.title} (${g.label} → ${g.tweetUrl})\n`;
        g.people.forEach((p, i) => { text += `  ${i + 1}. ${p.name}${p.age ? `, ${p.age} años` : ""}${p.source_id ? " ✓" : ""}\n`; });
      });
    } else {
      text += `\nTodos los localizados (${allTotal ?? all.length} total, mostrando ${all.length})\n`;
      all.forEach(p => { text += `  • ${p.name}${p.last_seen_location ? ` — ${p.last_seen_location}` : ""}\n`; });
    }
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function handleSubmitList(e: React.FormEvent) {
    e.preventDefault();
    setSubmitLoading(true);
    setSubmitError("");
    try {
      const r = await fetch("/api/submit-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitForm),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Error al enviar");
      setSubmitDone(true);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setSubmitLoading(false);
    }
  }

  function closeSubmitModal() {
    setShowSubmitModal(false);
    setSubmitDone(false);
    setSubmitError("");
    setSubmitForm({ submitter: "", hospital: "", tweetUrl: "", names: "" });
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

        {/* Tabs */}
        <div className="flex flex-col gap-3">
          <div className="flex gap-1 p-1 bg-gray-900 rounded-lg border border-gray-800">
            <button
              onClick={() => setTab("matched")}
              className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${tab === "matched" ? "bg-cyan-900 text-cyan-200" : "text-gray-500 hover:text-gray-300"}`}>
              🔍 Cruces
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${tab === "matched" ? "bg-cyan-700 text-cyan-100" : "bg-gray-800 text-gray-500"}`}>
                {confirmedMatched.length}
              </span>
            </button>
            <button
              onClick={() => setTab("listas")}
              className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${tab === "listas" ? "bg-amber-900 text-amber-200" : "text-gray-500 hover:text-gray-300"}`}>
              📋 Listas
              {groupedByList.length > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${tab === "listas" ? "bg-amber-700 text-amber-100" : "bg-gray-800 text-gray-500"}`}>
                  {groupedByList.reduce((s, g) => s + g.people.length, 0)}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab("all")}
              className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${tab === "all" ? "bg-green-900 text-green-200" : "text-gray-500 hover:text-gray-300"}`}>
              ✓ Todos
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${tab === "all" ? "bg-green-700 text-green-100" : "bg-gray-800 text-gray-500"}`}>
                {allTotal ?? (all.length > 0 ? all.length : "")}
              </span>
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
                    <p className="text-gray-200 font-semibold mb-1">Nivel de confianza</p>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-start gap-2">
                        <span className="text-base leading-none shrink-0">🟢</span>
                        <span className="text-gray-400"><strong className="text-gray-300">Cédula verificada</strong> — número de cédula coincide exactamente. Máxima confianza</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-base leading-none shrink-0">🟡</span>
                        <span className="text-gray-400"><strong className="text-gray-300">Alta confianza (≥ 85 %)</strong> — nombre prácticamente idéntico o variación ortográfica menor</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-base leading-none shrink-0">🟠</span>
                        <span className="text-gray-400"><strong className="text-gray-300">Confianza media (72 – 84 %)</strong> — posible variación de apellido o error tipográfico. Requiere verificación manual</span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="text-base leading-none shrink-0">⚫️</span>
                        <span className="text-gray-400"><strong className="text-gray-300">Sin cruce previo</strong> — aparece en lista hospitalaria pero no estaba en la base de desaparecidos</span>
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
                    ⚠️ Todos los cruces son aproximados. <strong className="text-gray-500">Verificar siempre con la fuente original</strong> antes de confirmar.
                  </p>
                </div>
              )}
              <p className="text-gray-600 text-[10px]">⚠️ Los cruces son aproximados — siempre verificar con la fuente original antes de confirmar.</p>
            </div>
          ) : tab === "listas" ? (
            <div className="flex flex-col gap-2">
              <p className="text-gray-400 text-xs leading-relaxed">
                Listas completas de pacientes publicadas en hospitales, tal como fueron difundidas.{" "}
                <strong className="text-amber-400">Incluye a todas las personas de cada lista</strong>, estuvieran o no en la base de desaparecidos.
                Las que muestran <span className="text-sm">🟡</span> o <span className="text-sm">🟠</span> fueron cruzadas; <span className="text-sm">⚫️</span> indica nueva entrada sin cruce previo.
              </p>
              <button
                onClick={() => setShowSubmitModal(true)}
                className="self-start px-3 py-1.5 rounded-lg border border-amber-700 text-amber-400 text-xs font-semibold hover:bg-amber-900/30 transition-colors">
                + Enviar lista
              </button>
            </div>
          ) : (
            <p className="text-gray-400 text-xs leading-relaxed">
              Todos los registros con estado <strong className="text-green-400">localizado / encontrado</strong> en nuestra base de datos, de cualquier fuente.
            </p>
          )}
        </div>

        {/* Inline stats — matched tab only */}
        {tab === "matched" && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="grid grid-cols-2 divide-x divide-y divide-gray-800">
              <div className="px-4 py-3 flex flex-col gap-0.5">
                <p className="text-gray-500 text-[10px] uppercase tracking-wide">Desaparecidos</p>
                <p className="text-white text-2xl font-bold">{sinContactoTotal != null ? sinContactoTotal.toLocaleString("es-VE") : "…"}</p>
                <p className="text-gray-600 text-[10px]">sin contacto activos</p>
              </div>
              <div className="px-4 py-3 flex flex-col gap-0.5">
                <p className="text-green-400 text-[10px] uppercase tracking-wide">Localizados</p>
                <p className="text-white text-2xl font-bold">{allTotal != null ? allTotal.toLocaleString("es-VE") : "…"}</p>
                {sinContactoTotal != null && allTotal != null && (
                  <p className="text-green-700 text-[10px]">{((allTotal / (allTotal + sinContactoTotal)) * 100).toFixed(1)}% del total reportado</p>
                )}
              </div>
              <div className="px-4 py-3 flex flex-col gap-0.5">
                <p className="text-cyan-400 text-[10px] uppercase tracking-wide">Cruces confirmados</p>
                <p className="text-white text-2xl font-bold">{confirmedMatched.length}</p>
                <p className="text-gray-600 text-[10px]">tenían reporte previo en la base</p>
              </div>
              <div className="px-4 py-3 flex flex-col gap-0.5">
                <p className="text-amber-400 text-[10px] uppercase tracking-wide">Nuevas entradas</p>
                <p className="text-white text-2xl font-bold">{matchedTotal != null ? (matchedTotal - confirmedMatched.length).toLocaleString("es-VE") : "…"}</p>
                <p className="text-gray-600 text-[10px]">en hospital, sin reporte previo</p>
              </div>
            </div>
            {groupedAllMatched.length > 0 && (
              <div className="border-t border-gray-800 px-4 py-3 flex flex-col gap-2">
                <p className="text-gray-500 text-[10px] uppercase tracking-wide font-semibold">
                  {groupedAllMatched.length} lista{groupedAllMatched.length !== 1 ? "s" : ""} procesadas · {groupedAllMatched.reduce((s, g) => s + g.total, 0)} personas
                </p>
                <div className="flex flex-col divide-y divide-gray-800/60">
                  {groupedAllMatched.map((g, i) => {
                    const hitRate = g.total > 0 ? Math.round((g.confirmed / g.total) * 100) : 0;
                    return (
                      <div key={i} className="flex items-center justify-between gap-3 py-2">
                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                          <p className="text-gray-300 text-xs font-medium leading-tight truncate">{g.title}</p>
                          {g.tweetUrl && (
                            <a href={g.tweetUrl} target="_blank" rel="noopener noreferrer"
                              className="text-gray-600 text-[10px] hover:text-amber-500 hover:underline">{g.label} ↗</a>
                          )}
                        </div>
                        <div className="shrink-0 text-right flex flex-col gap-0.5">
                          <p className="text-white text-xs font-bold">{g.total} personas</p>
                          <p className="text-cyan-600 text-[10px]">{g.confirmed} cruces 🟡 ({hitRate}%)</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

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
                    const { circle: mc, label: mcLabel } = matchCircle(p.external_source, true);
                    const isVzb = p.source_id?.startsWith("vzb_");
                    const platformLabel = isVzb ? "venezulatebusca.com" : "desaparecidosterremotovenezuela.com";
                    const platformUrl = isVzb
                      ? "https://venezulatebusca.com"
                      : p.source_id
                        ? `https://desaparecidosterremotovenezuela.com/?persona=${p.source_id}`
                        : "https://desaparecidosterremotovenezuela.com";
                    return (
                      <div key={pi} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                        <button
                          className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-800/40 transition-colors"
                          onClick={() => setExpandedId(isExpanded ? null : p.id)}>
                          {p.photo_url
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={p.photo_url} alt={p.name} className="w-10 h-10 rounded-full object-cover border border-cyan-700 shrink-0" />
                            : <div className="w-10 h-10 rounded-full bg-cyan-900/60 border border-cyan-700 flex items-center justify-center text-cyan-400 text-sm shrink-0">✓</div>
                          }
                          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                            <p className="font-semibold text-white text-sm">{p.name}</p>
                            <div className="flex items-center gap-2 flex-wrap">
                              {p.age && <span className="text-gray-500 text-xs">{p.age} años</span>}
                              {p.last_seen_location && <span className="text-gray-400 text-xs">📍 {p.last_seen_location}</span>}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span title={mcLabel} className="text-base leading-none">{mc}</span>
                            <span className="text-gray-600 text-xs">{isExpanded ? "▲" : "▼"}</span>
                          </div>
                        </button>
                        {isExpanded && (
                          <div className="border-t border-gray-800 px-4 py-3 flex flex-col gap-3">
                            {p.photo_url && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.photo_url} alt={p.name} className="w-full max-h-52 object-cover rounded-lg border border-gray-700" />
                            )}
                            {p.description && (
                              <p className="text-gray-300 text-sm leading-relaxed">{p.description}</p>
                            )}
                            {p.contact_info && (
                              <p className="text-amber-300 text-sm">☎ {p.contact_info}</p>
                            )}
                            <div className="border-t border-gray-800 pt-2 flex flex-col gap-1">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="text-gray-600 text-[10px] uppercase tracking-wide">Fuentes</p>
                                <span className="text-[10px] text-gray-400 font-medium">{mc} {mcLabel}</span>
                              </div>
                              <a href={platformUrl} target="_blank" rel="noopener noreferrer"
                                className="text-gray-500 text-xs hover:text-violet-400 hover:underline">
                                📋 Reportado como desaparecido en {platformLabel} ↗
                              </a>
                              {p.source2_url
                                ? <a href={p.source2_url} target="_blank" rel="noopener noreferrer"
                                    className="text-cyan-500 text-xs hover:text-cyan-300 hover:underline">
                                    🏥 Confirmado: {group.title} ↗
                                  </a>
                                : <span className="text-cyan-400 text-xs">🏥 Confirmado: {group.title}</span>
                              }
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

        {/* Listas tab — full hospital rosters */}
        {!loading && tab === "listas" && (
          <>
            {filteredLists.length === 0 && <div className="text-center text-gray-600 py-12 text-sm">Sin listas cargadas</div>}
            {filteredLists.length > 0 && (
              <p className="text-gray-500 text-xs">
                {filteredLists.length} lista{filteredLists.length !== 1 ? "s" : ""} · {filteredLists.reduce((s, g) => s + g.people.length, 0)} personas
              </p>
            )}
            {filteredLists.map((group, gi) => {
              const isOpen = expandedList === group.tweetUrl;
              const matched_count = group.people.filter(p => !!p.source_id).length;
              return (
                <div key={gi} className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
                  {/* Accordion header */}
                  <button
                    className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-gray-800/40 transition-colors"
                    onClick={() => setExpandedList(isOpen ? null : group.tweetUrl)}>
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <p className="text-white font-semibold text-sm leading-tight">{group.title}</p>
                      <a
                        href={group.tweetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-amber-500 text-xs hover:underline w-fit"
                        onClick={e => e.stopPropagation()}>
                        {group.label} ↗
                      </a>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-white text-xs font-bold">{group.people.length} personas</span>
                      <span className="text-cyan-600 text-[10px]">{matched_count} cruces 🟡</span>
                      <span className="text-gray-500 text-xs">{isOpen ? "▲" : "▼"}</span>
                    </div>
                  </button>
                  {/* Accordion body */}
                  {isOpen && (
                    <div className="border-t border-gray-800 divide-y divide-gray-800">
                      {group.people.map((p, pi) => {
                        const wasInDb = !!p.source_id;
                        const { circle: lc, label: lcLabel } = matchCircle(p.external_source, wasInDb);
                        return (
                          <div key={pi} className="px-4 py-2.5 flex items-center gap-3">
                            <span className="text-gray-600 text-xs w-5 shrink-0">{pi + 1}.</span>
                            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                              <p className="text-white text-sm font-medium">{p.name}</p>
                              {(p.age || p.last_seen_location) && (
                                <p className="text-gray-500 text-xs">
                                  {p.age ? `${p.age} años` : ""}{p.age && p.last_seen_location ? " · " : ""}{p.last_seen_location ?? ""}
                                </p>
                              )}
                            </div>
                            <span title={lcLabel} className="text-[11px] shrink-0">{lc}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {allHasMore && !ql && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full py-3 rounded-lg border border-amber-800 text-amber-400 text-sm font-semibold hover:bg-amber-900/30 transition-colors disabled:opacity-50">
                {loadingMore ? "Cargando..." : `Ver más listas · ${allTotal! - all.length} registros restantes`}
              </button>
            )}
          </>
        )}

        {/* All tab — flat list */}
        {!loading && tab === "all" && (
          <>
            {filteredAll.length === 0 && <div className="text-center text-gray-600 py-12 text-sm">Sin resultados</div>}
            {allTotal != null && (
              <p className="text-gray-600 text-xs">
                Mostrando {all.length} de {allTotal} registros
                {allHasMore ? ` — usa "Ver más" para cargar el resto` : ""}
              </p>
            )}
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
            {allHasMore && !ql && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full py-3 rounded-lg border border-green-800 text-green-400 text-sm font-semibold hover:bg-green-900/30 transition-colors disabled:opacity-50">
                {loadingMore ? "Cargando..." : `Ver más · ${allTotal! - all.length} restantes`}
              </button>
            )}
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
            {tab === "matched" && (
              <p className="text-gray-600 text-xs text-center">
                ¿Error en el cruce? →{" "}
                <a href="https://x.com/mariojllesca" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400">@mariojllesca</a>
              </p>
            )}
          </div>
        )}
      </div>

      {/* Submit list modal */}
      {showSubmitModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={e => { if (e.target === e.currentTarget) closeSubmitModal(); }}>
          <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <p className="text-white font-semibold text-sm">Enviar lista de pacientes</p>
              <button onClick={closeSubmitModal} className="text-gray-500 hover:text-white text-lg leading-none">×</button>
            </div>
            {submitDone ? (
              <div className="px-5 py-8 flex flex-col items-center gap-3 text-center">
                <span className="text-3xl">✅</span>
                <p className="text-white font-semibold text-sm">Lista recibida</p>
                <p className="text-gray-400 text-xs leading-relaxed">
                  La revisaremos y la procesaremos para cruzarla contra la base de desaparecidos. Gracias por contribuir.
                </p>
                <button onClick={closeSubmitModal} className="mt-2 px-4 py-2 rounded-lg bg-amber-800 hover:bg-amber-700 text-amber-100 text-sm font-semibold transition-colors">
                  Cerrar
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmitList} className="px-5 py-4 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-gray-400 text-xs font-medium">Tu nombre o cómo contactarte <span className="text-gray-600">(opcional)</span></label>
                  <input
                    value={submitForm.submitter}
                    onChange={e => setSubmitForm(f => ({ ...f, submitter: e.target.value }))}
                    placeholder="Nombre, @usuario, teléfono..."
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-gray-400 text-xs font-medium">Hospital o fuente <span className="text-red-500">*</span></label>
                  <input
                    required
                    value={submitForm.hospital}
                    onChange={e => setSubmitForm(f => ({ ...f, hospital: e.target.value }))}
                    placeholder="Ej: Hospital Pérez Carreño, Caracas — 25 jun 2026"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-gray-400 text-xs font-medium">Link al tweet / publicación <span className="text-gray-600">(opcional)</span></label>
                  <input
                    value={submitForm.tweetUrl}
                    onChange={e => setSubmitForm(f => ({ ...f, tweetUrl: e.target.value }))}
                    placeholder="https://x.com/..."
                    type="url"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-gray-400 text-xs font-medium">Nombres de la lista <span className="text-gray-600">(opcional — uno por línea o separados por coma)</span></label>
                  <textarea
                    value={submitForm.names}
                    onChange={e => setSubmitForm(f => ({ ...f, names: e.target.value }))}
                    placeholder={"Juan Pérez\nMaría González\nCarlos López..."}
                    rows={5}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 resize-none font-mono"
                  />
                </div>
                {submitError && (
                  <p className="text-red-400 text-xs">{submitError}</p>
                )}
                <button
                  type="submit"
                  disabled={submitLoading}
                  className="w-full py-3 rounded-lg bg-amber-700 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                  {submitLoading ? "Enviando..." : "Enviar lista →"}
                </button>
                <p className="text-gray-600 text-[10px] text-center leading-relaxed">
                  La información se revisará manualmente antes de publicarse. Si tienes una foto de la lista, adjúntala al tweet que nos menciones.
                </p>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
