'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Header from './Header';
import FieldCard from './FieldCard';
import Sidebar from './Sidebar';
import ThemeToggle from './ThemeToggle';
import AnalyzePanel, { Row } from './AnalyzePanel';
import { useTheme } from '../context/ThemeContext';
import { Plus, ArrowLeft, Play, Trash2, Wand2, Globe, Table2, RefreshCw, Sparkles } from 'lucide-react';

/* ---------------- Types ---------------- */
type GeneratorMode = 'ai' | 'web';
interface Field { name: string; description?: string; useAI: boolean; }
interface HistoryItem { id: string; description: string; timestamp: string; data: Row[]; }
interface ReasoningResponse { reasoning: string; scorecard?: Record<string, any>; }
interface DependencyResp {
  fields: string[];
  parents: Record<string, string[]>;
  matrix: number[][];
}

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000';

/* --------------- Helpers --------------- */
const sanitizeFields = (fs: Field[]) =>
  fs.filter(f => f.name?.trim()).map(f => ({ name: f.name.trim(), description: (f.description || '').trim() }));
const namesFromFields = (fs: Field[]) => sanitizeFields(fs).map(f => f.name);
const ID_HINTS = ['id', 'uuid'];

const refineForHeading = (s: string, max = 92) => {
  const one = (s || '').replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : one.slice(0, max - 1).trimEnd() + '…';
};

/* Heuristic pairs (client side) */
const HEUR_RULES: Array<[string, string[]]> = [
  ['name', ['gender']], ['speciality', ['age']], ['rank', ['gpa']],
  ['occupation', ['education', 'age']], ['state', ['country']], ['district', ['state']],
  ['city', ['state', 'country']], ['price', ['category']], ['salary', ['role', 'experience', 'rank']],
  ['final_score', ['score', 'weight']],
];

const edgeKey = (i: number, j: number) => `${i}->${j}`;

const parentsToMatrix = (fields: string[], parents: Record<string, string[]>) =>
  fields.map((child) => fields.map((par) => (child !== par && parents[child]?.includes(par) ? 1 : 0)));

const matrixToParents = (fields: string[], m: number[][]) => {
  const out: Record<string, string[]> = {};
  fields.forEach((c, i) => {
    out[c] = [];
    fields.forEach((p, j) => (i !== j && m[i]?.[j] === 1 ? out[c].push(p) : null));
  });
  return out;
};

const toposort = (fields: string[], m: number[][]) => {
  const n = fields.length, indeg = Array(n).fill(0), kids: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (m[i]?.[j] === 1) { indeg[i]++; kids[j].push(i); }
  const q = indeg.map((d, i) => (d === 0 ? i : -1)).filter(i => i >= 0); const order: number[] = [];
  while (q.length) { const u = q.shift()!; order.push(u); for (const v of kids[u]) if (--indeg[v] === 0) q.push(v); }
  return { dag: order.length === n, topo: order.length === n ? order.map(i => fields[i]) : null };
};

const heuristicParents = (names: string[]) => {
  const lower = names.map(n => n.toLowerCase()); const p: Record<string, string[]> = {}; names.forEach(n => p[n] = []);
  names.forEach(n => { if (ID_HINTS.some(h => n.toLowerCase().includes(h))) p[n] = []; });
  for (const [cL, prs] of HEUR_RULES) {
    const ci = lower.indexOf(cL); if (ci < 0) continue;
    const child = names[ci];
    p[child] = Array.from(new Set([...(p[child] || []), ...prs.filter(x => lower.includes(x) && names[lower.indexOf(x)] !== child).slice(0, 2)]));
  }
  return p;
};

const mergeHybrid = (fields: string[], heur: Record<string, string[]>, llm?: Record<string, string[]>) => {
  const conf: Record<string, number> = {};
  const merged: Record<string, string[]> = {};
  for (const c of fields) {
    const set = new Set<string>();
    (heur[c] || []).forEach(p => { set.add(p); conf[`${c}<-${p}`] = Math.max(conf[`${c}<-${p}`] || 0, 0.5); });
    (llm?.[c] || []).forEach(p => { set.add(p); conf[`${c}<-${p}`] = Math.max(conf[`${c}<-${p}`] || 0, 0.7); });
    merged[c] = ID_HINTS.some(h => c.toLowerCase().includes(h)) ? [] : Array.from(set);
  }
  return { matrix: parentsToMatrix(fields, merged), confidence: conf };
};

const refineToDag = (fields: string[], m: number[][], conf: Record<string, number>, locked: Set<string>) => {
  const a = m.map(r => r.slice());
  if (toposort(fields, a).dag) return a;
  const edges: { i: number; j: number; conf: number; lock: boolean }[] = [];
  for (let i = 0; i < fields.length; i++) for (let j = 0; j < fields.length; j++) if (i !== j && a[i][j] === 1)
    edges.push({ i, j, conf: conf[`${fields[i]}<-${fields[j]}`] ?? 0.6, lock: locked.has(edgeKey(i, j)) });
  edges.sort((x, y) => (x.lock === y.lock ? x.conf - y.conf : x.lock ? 1 : -1));
  for (const e of edges) { if (e.lock) continue; const prev = a[e.i][e.j]; a[e.i][e.j] = 0; if (toposort(fields, a).dag) return a; a[e.i][e.j] = prev; }
  return a;
};

const ensureRelation = (fields: string[], m: number[][]) => {
  const n = fields.length; if (n < 2) return m;
  let hasEdge = false; for (let i = 0; i < n && !hasEdge; i++) for (let j = 0; j < n; j++) if (m[i]?.[j] === 1) { hasEdge = true; break; }
  if (hasEdge) return m;
  const p = fields.findIndex(f => !f.toLowerCase().includes('id')); const c = n - 1;
  if (p >= 0 && p !== c) { const next = m.map(r => r.slice()); if (!next[c]) next[c] = Array(n).fill(0); next[c][p] = 1; return next; }
  return m;
};

/* ---------------- Matrix Component ---------------- */
function Matrix({
  fields, matrix, setMatrix, locked, setLocked, onInfer, dag,
}: {
  fields: string[]; matrix: number[][]; setMatrix: (m: number[][]) => void;
  locked: Set<string>; setLocked: (s: Set<string>) => void; onInfer: () => void; dag: boolean;
}) {
  const toggle = (i: number, j: number) => {
    if (i === j) return;
    const next = matrix.map(r => r.slice()); next[i][j] = next[i][j] ? 0 : 1;
    const locks = new Set(locked); locks.add(edgeKey(i, j)); setLocked(locks); setMatrix(next);
  };
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold"><Table2 size={16} /> Field Dependency Matrix</div>
        <div className="flex items-center gap-3">
          <span className="text-xs">{dag ? <span className="text-emerald-600">Acyclic</span> : <span className="text-amber-600">Has cycles</span>}</span>
          <button onClick={onInfer} type="button" className="mac-ghost text-sm px-3 py-1.5">
            <span className="inline-flex items-center gap-2"><Table2 size={14} /> Infer Dependency</span>
          </button>
        </div>
      </div>
      <div className="overflow-auto border border-slate-200 dark:border-slate-800 rounded-lg">
        <table className="min-w-max text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-slate-50 dark:bg-slate-900 z-10 border-r border-slate-200 dark:border-slate-800"></th>
              {fields.map(p => <th key={p} className="px-2 py-1 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">{p}</th>)}
            </tr>
          </thead>
          <tbody>
            {fields.map((child, i) => (
              <tr key={child}>
                <th className="sticky left-0 bg-white dark:bg-slate-900 z-10 px-2 py-1 border-r border-slate-200 dark:border-slate-800 text-left">{child}</th>
                {fields.map((par, j) => {
                  const on = i !== j && matrix[i]?.[j] === 1;
                  const cellCls = i === j
                    ? 'bg-slate-100/60 dark:bg-slate-800/40 text-slate-300'
                    : on
                      ? 'bg-emerald-100/70 dark:bg-emerald-900/40 text-emerald-700 hover:opacity-80'
                      : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800';
                  return (
                    <td key={`${i}-${j}`} onClick={() => toggle(i, j)}
                      className={`px-2 py-1 text-center border-b border-slate-200 dark:border-slate-800 cursor-pointer select-none ${cellCls}`}>
                      {i === j ? '—' : on ? '1' : '0'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-xs text-slate-500">Legend: Matrix[row <em>(child)</em>][col <em>(parent)</em>] = 1 → “child depends on parent”.</div>
    </div>
  );
}

/* ---------------- Main Studio ---------------- */
export default function Studio() {
  useTheme();

  // Steps
  const [sidebarIsCollapsed, setSidebarIsCollapsed] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: demographic + description
  const [demographic, setDemographic] = useState('India');
  const [country, setCountry] = useState('hi_IN');   // backend locale
  const [description, setDescription] = useState('');

  // Textarea typing: prevent global handlers from stealing focus
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  const stopCap = (e: any) => e.stopPropagation();

  // Step 2: schema fields
  const [fields, setFields] = useState<Field[]>([]);
  const [lastSchemaMode, setLastSchemaMode] = useState<GeneratorMode | null>(null);
  const [schemaVariant, setSchemaVariant] = useState(0); // “More like this”

  // Data & charts
  const [rows, setRows] = useState<Row[]>([]);
  const [reasoning, setReasoning] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [chartSuggestions, setChartSuggestions] = useState<any[]>([]);
  const [chartGlobalReasoning, setChartGlobalReasoning] = useState<string>('');
  const [tableSuggestions, setTableSuggestions] = useState<string[]>([]);
  const [tableSuggestionSchemas, setTableSuggestionSchemas] = useState<Record<string, { name: string; description?: string }[]>>({});

  /* ---------- Dependencies (manual hybrid) ---------- */
  const names = useMemo(() => namesFromFields(fields), [fields]);
  const [depMatrix, setDepMatrix] = useState<number[][]>([]);
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const confRef = useRef<Record<string, number>>({});

  const dagStatus = useMemo(() => toposort(names, depMatrix || []), [names, depMatrix]);

  // 🔹 The important part: build dependency list **by field index**
  const parentsByIndex = useMemo(() => {
    const out: string[][] = [];
    const n = names.length;
    for (let i = 0; i < n; i++) {
      const row = depMatrix?.[i] || [];
      const deps: string[] = [];
      for (let j = 0; j < n; j++) {
        if (i !== j && row[j] === 1) deps.push(names[j]);
      }
      out.push(deps);
    }
    return out;
  }, [depMatrix, names]);

  const inferHybrid = async () => {
    if (!names.length) return;
    const heur = heuristicParents(names);
    let llm: Record<string, string[]> | undefined;
    try {
      const res = await fetch(`${BASE_URL}/api/field-dependency/infer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        
body: JSON.stringify({
  fields: sanitizeFields(fields),
  sample_rows: [],                   // you can pass a small sample of rows if available
  dataset_description: description,  // <-- this is important
  mode: 'llm',
  max_parents_per_field: null,       // or a number like 3
  enforce_acyclic: true
}),

      });
      if (res.ok) llm = (await res.json() as DependencyResp).parents;
    } catch { /* ignore */ }
    const { matrix, confidence } = mergeHybrid(names, heur, llm);
    confRef.current = confidence;

    // re-apply locked edges, refine to DAG, ensure at least one relation
    const withLocked = matrix.map(r => r.slice());
    for (const k of locked) {
      const [i, j] = k.split('->').map(Number);
      if (Number.isFinite(i) && Number.isFinite(j) && i !== j) withLocked[i][j] = 1;
    }
    const refined = refineToDag(names, withLocked, confRef.current, locked);
    setDepMatrix(ensureRelation(names, refined));
  };

  useEffect(() => {
    if (!depMatrix?.length) return;
    if (!toposort(names, depMatrix).dag) {
      const refined = refineToDag(names, depMatrix, confRef.current, locked);
      setDepMatrix(ensureRelation(names, refined));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(depMatrix)]);

  /* ---------- Schema: AI / Web ---------- */
  const runAISchema = async (variantBump = 0) => {
    if (!description.trim()) { descRef.current?.focus(); return; }
    setLoading(true);
    try {
      const desc = variantBump ? `${description}\n\n(variation ${variantBump})` : description;
      const res = await fetch(`${BASE_URL}/suggest-schema`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc, max_fields: 6 }),
      });
      if (!res.ok) throw new Error(`POST /suggest-schema ${res.status}`);
      const data = await res.json();
      const next = (data.fields || []).map((f: any) => ({ name: f?.name ?? '', description: f?.description ?? '', useAI: true }));
      setFields(next);
      setDepMatrix([]);       // reset matrix for a fresh build
      setLocked(new Set());
      setLastSchemaMode('ai');
      setStep(2);
    } catch (e) { console.error('AI schema error:', e); } finally { setLoading(false); }
  };

  const runWebSchema = async (variantBump = 0) => {
    if (!description.trim()) { descRef.current?.focus(); return; }
    setLoading(true);
    try {
      const desc = variantBump ? `${description}\n\n(variation ${variantBump})` : description;
      const res = await fetch(`${BASE_URL}/suggest-schema-web`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc, max_fields: 6 }),
      });
      if (!res.ok) throw new Error(`POST /suggest-schema-web ${res.status}`);
      const data = await res.json();
      const next = (data.fields || []).map((f: any) => ({ name: f?.name ?? '', description: f?.description ?? '', useAI: true }));
      setFields(next);
      setDepMatrix([]);       // reset matrix for a fresh build
      setLocked(new Set());
      setLastSchemaMode('web');
      setStep(2);
    } catch (e) { console.error('Web schema error:', e); } finally { setLoading(false); }
  };

  const regenerateSchema = async () => {
    if (!lastSchemaMode) return;
    const v = schemaVariant + 1;
    setSchemaVariant(v);
    if (lastSchemaMode === 'ai') return runAISchema(v);
    return runWebSchema(v);
  };
  const moreLikeThisSchema = async () => regenerateSchema();

  /* ---------- Charts & Reasoning ---------- */
  const fallbackCharts = (rs: Row[]) => {
    const cols = rs[0] ? Object.keys(rs[0]) : [];
    const nums = cols.filter(c => rs.some(r => !isNaN(Number(String(r[c]).replace(/,/g, '')))));
    const out: any[] = [];
    if (nums[0]) out.push({ chart_type: 'bar', x: cols[0] || null, y: [nums[0]], group_by: null, aggregation: 'sum', reasoning: 'Fallback bar', explanation: 'Totals by category.' });
    if (nums[1]) out.push({ chart_type: 'scatter', x: null, y: [nums[0], nums[1]], group_by: null, aggregation: null, reasoning: 'Fallback scatter', explanation: 'Relationship between two measures.' });
    return out;
  };

  const fetchCharts = async (rs: Row[]) => {
    if (!rs?.length) { setChartSuggestions([]); setChartGlobalReasoning(''); setTableSuggestions([]); setTableSuggestionSchemas({}); return; }
    try {
      const res = await fetch(`${BASE_URL}/api/charts/suggest-charts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, country, rows: rs }),
      });
      if (!res.ok) throw new Error(`POST /api/charts/suggest-charts ${res.status}`);
      const data = await res.json();
      setChartSuggestions(data?.suggestions || []);
      setChartGlobalReasoning(data?.global_reasoning || '');
      setTableSuggestions(data?.table_suggestions || []);
      setTableSuggestionSchemas(data?.table_suggestion_schemas || {});
    } catch (e) {
      console.error(e);
      setChartSuggestions(fallbackCharts(rs));
      setChartGlobalReasoning('Client fallback');
      setTableSuggestions([]);
      setTableSuggestionSchemas({});
    }
  };

  const requestReasoning = async (rs: Row[], gen: GeneratorMode, fs: Field[]) => {
    try {
      const res = await fetch(`${BASE_URL}/api/reasoning/generate-reasoning`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schema: sanitizeFields(fs),
          generatorMode: gen,
          dataset: rs.slice(0, 50),
          criteria: [
            'schema alignment',
            'semantic relevance',
            'source reliability (web mode)',
            'contextual consistency',
            'scoring thresholds',
          ],
        }),
      });
      if (!res.ok) throw new Error(`POST /api/reasoning/generate-reasoning ${res.status}`);
      const data: ReasoningResponse = await res.json();
      return (data?.reasoning || '').trim() || null;
    } catch { return null; }
  };

  /* ---------- Generate ---------- */
  const generate = async (extraContext?: string) => {
    if (!sanitizeFields(fields).length) return;
    setLoading(true);
    try {
      const mode: GeneratorMode = fields.some(f => !f.useAI) ? 'web' : 'ai';

      const namesNow = namesFromFields(fields);
      const parents = matrixToParents(namesNow, depMatrix || []);

      const composedDesc = extraContext
        ? `${description}\n\nTable suggestion context: ${extraContext}`
        : description;

      const res = await fetch(`${BASE_URL}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: composedDesc,
          country,
          rows: 20,
          fields: sanitizeFields(fields),
          generator: mode,
          relations: { parents }, // backend safely ignores if not modeled
        }),
      });
      if (!res.ok) throw new Error(`POST /generate ${res.status}`);
      const data = await res.json();
      const payload = Array.isArray(data) ? data : (data?.rows ?? []);
      const rs: Row[] = payload.map((r: any) => (r && typeof r === 'object' ? r : {}));
      setRows(rs);

      const defaultR = mode === 'ai' ? 'Generated via AI (LLM).' : 'Generated via Web mode.';
      setReasoning('Evaluating dataset quality…');
      await Promise.all([
        fetchCharts(rs),
        (async () => setReasoning((await requestReasoning(rs, mode, fields)) || defaultR))(),
      ]);

      setHistory(p => [
        {
          id: Date.now().toString(),
          description: `${refineForHeading(description)} ${mode === 'ai' ? '[AI]' : '[Web]'}`,
          timestamp: new Date().toLocaleTimeString(),
          data: rs,
        },
        ...p,
      ]);

      setStep(3);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  // CSV (AnalyzePanel)
  const downloadCSV = () => {
    if (!rows.length) return;
    const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const hdr = Object.keys(rows[0]).map(esc).join(',');
    const body = rows.map(r => Object.values(r).map(esc).join(',')).join('\n');
    const blob = new Blob([`${hdr}\n${body}`], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'synthetic_data.csv';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  };

  // Apply table suggestion (Analyze)
  const handleApplyTableSuggestion = async (suggestion: string) => {
    const blueprint = tableSuggestionSchemas?.[suggestion];
    if (Array.isArray(blueprint) && blueprint.length) {
      setFields(blueprint.map(b => ({ name: b.name, description: b.description || '', useAI: true })));
      setDepMatrix([]);
      setLocked(new Set());
      await new Promise(requestAnimationFrame);
      await inferHybrid();
    }
    await generate(suggestion);
  };

  /* ---------------- UI ---------------- */
  return (
    <div className="flex min-h-screen transition-colors duration-500" style={{ ['--app-header-h' as any]: '72px' }}>
      <Header />
      

      <Sidebar
        history={history}
        isCollapsed={sidebarIsCollapsed}
        onToggle={() => setSidebarIsCollapsed(v => !v)}
        onSelect={(it) => { setRows(it.data); setDescription(it.description); setStep(3); }}
        onDelete={(id) => setHistory(p => p.filter(x => x.id !== id))}
      />

      <div className={`flex-1 transition-all duration-300 ${sidebarIsCollapsed ? 'pl-20' : 'pl-64'}`}>
        <div className="p-4 md:p-8 text-slate-900 dark:text-slate-100 font-sans" style={{ paddingTop: 'var(--app-header-h)' }}>
          {/* Widen canvas */}
          <main className="max-w-[1500px] mx-auto">
            {/* Step 1 */}
            {step === 1 && (
              <div className="mac-card p-8 max-w-[1200px] mx-auto mt-6">
                <div className="mb-6">
                  <h1 className="text-2xl md:text-[28px] font-semibold text-slate-900 dark:text-slate-100">
                    Create a dataset
                  </h1>
                  <p className="text-[14px] text-slate-600 dark:text-slate-400 mt-1">
                    Pick a demographic, describe your dataset, then select how the schema should be suggested.
                  </p>
                </div>

                {/* Select Demographic */}
                <div className="mb-6">
                  <label className="block text-[15px] font-semibold mb-2 text-slate-700 dark:text-slate-200">
                    Select Demographic
                  </label>
                  <select
                    className="w-full p-3.5 mac-input"
                    value={demographic}
                    onChange={(e) => {
                      const d = e.target.value;
                      setDemographic(d);
                      const map: Record<string, string> = {
                        India: 'hi_IN', USA: 'en_US', England: 'en_GB', Japan: 'ja_JP',
                        China: 'zh_CN', France: 'fr_FR', Germany: 'de_DE'
                      };
                      setCountry(map[d] || 'hi_IN');
                    }}
                  >
                    <option>India</option>
                    <option>USA</option>
                    <option>England</option>
                    <option>Japan</option>
                    <option>China</option>
                    <option>France</option>
                    <option>Germany</option>
                  </select>
                </div>

                {/* Dataset Description */}
                <div className="mb-8">
                  <label className="block text-[15px] font-semibold mb-2 text-slate-700 dark:text-slate-200">
                    Dataset Description
                  </label>
                  <textarea
                    ref={descRef}
                    className="w-full p-4 mac-input h-40 text-[15px] placeholder:text-slate-400"
                    value={description}
                    onKeyDownCapture={stopCap}
                    onKeyUpCapture={stopCap}
                    onMouseDownCapture={stopCap}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g., Planetary dataset for an education app: planet name, classification, orbital period (days), mass (kg), discovery year."
                  />
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Tip: two clear sentences work best.</p>
                </div>

                {/* Select Schema */}
                <div>
                  <label className="block text-[15px] font-semibold mb-3 text-slate-700 dark:text-slate-200">
                    Select Schema
                  </label>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <button
                      onClick={() => runAISchema()}
                      disabled={loading || !description.trim()}
                      className="mac-tile disabled:opacity-50"
                      type="button"
                    >
                      <div className="h-10 w-10 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 flex items-center justify-center">
                        <Wand2 size={18} />
                      </div>
                      <div>
                        <div className="text-[16px] font-semibold text-slate-900 dark:text-slate-100">AI Schema Suggestion</div>
                        <div className="text-[13px] text-slate-600 dark:text-slate-400">Clear, concise fields from your description.</div>
                      </div>
                    </button>

                    <button
                      onClick={() => runWebSchema()}
                      disabled={loading || !description.trim()}
                      className="mac-tile disabled:opacity-50"
                      type="button"
                    >
                      <div className="h-10 w-10 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 flex items-center justify-center">
                        <Globe size={18} />
                      </div>
                      <div>
                        <div className="text-[16px] font-semibold text-slate-900 dark:text-slate-100">Web Schema Suggestion</div>
                        <div className="text-[13px] text-slate-600 dark:text-slate-400">Infobox-like fields inferred from the web.</div>
                      </div>
                    </button>
                  </div>

                  {lastSchemaMode && (
                    <div className="mt-4 flex items-center gap-2">
                      <button onClick={regenerateSchema} className="mac-ghost text-sm" type="button">
                        <span className="inline-flex items-center gap-2"><RefreshCw size={14} /> Regenerate schema</span>
                      </button>
                      <button onClick={moreLikeThisSchema} className="mac-ghost text-sm" type="button">
                        <span className="inline-flex items-center gap-2"><Sparkles size={14} /> More like this</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 2: Fields + Matrix + Generate */}
            {step === 2 && (
              <div className="mac-card p-8 max-w-[1400px] mx-auto mt-8">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[22px] md:text-[26px] font-semibold text-slate-900 dark:text-slate-100">
                      Suggested field names based on your description
                    </h2>
                    <p className="text-[14px] md:text-[15px] text-slate-600 dark:text-slate-400 mt-1 italic">
                      “{refineForHeading(description)}”
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setStep(1)} className="mac-ghost text-sm" type="button" title="Back">
                      <span className="inline-flex items-center gap-2"><ArrowLeft size={16} /> Back</span>
                    </button>
                    <button onClick={regenerateSchema} className="mac-ghost text-sm" type="button">
                      <span className="inline-flex items-center gap-2"><RefreshCw size={16} /> Regenerate</span>
                    </button>
                    <button onClick={moreLikeThisSchema} className="mac-ghost text-sm" type="button">
                      <span className="inline-flex items-center gap-2"><Sparkles size={16} /> More like this</span>
                    </button>
                  </div>
                </div>

                {/* Fields (each single-row) */}
                <div className="space-y-3 mt-6">
                  {fields.length === 0 && (
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      No fields yet. Use “Regenerate” to request a schema again.
                    </div>
                  )}
                  {fields.map((f, i) => (
                    <div key={i} className="relative border border-slate-200/70 dark:border-slate-800/70 rounded-2xl p-3 md:p-4 bg-white/85 dark:bg-slate-900/75">
                      <button
                        onClick={() => {
                          setFields(p => p.filter((_, idx) => idx !== i));
                          setLocked(prev => new Set([...prev].filter(k => {
                            const [ii, jj] = k.split('->').map(Number);
                            return ii !== i && jj !== i;
                          })));
                          setDepMatrix(m => (m?.length ? m.filter((_, ii) => ii !== i).map(r => r.filter((_, jj) => jj !== i)) : m));
                        }}
                        className="absolute right-2 top-2 text-slate-400 hover:text-red-500 transition"
                        type="button"
                        aria-label="Remove field"
                      >
                        <Trash2 size={16} />
                      </button>

                      <FieldCard
                        index={i}
                        data={f}
                        editable
                        onUpdate={(idx, key, val) => {
                          const u = [...fields];
                          (u[idx] as any)[key] = val;
                          setFields(u);
                        }}
                        /** ✅ pass live dependencies by index so renames don't break mapping */
                        dependencies={parentsByIndex[i] || []}
                      />
                    </div>
                  ))}
                </div>

                {/* Matrix */}
                {fields.length > 1 && (
                  <Matrix
                    fields={names}
                    matrix={depMatrix || []}
                    setMatrix={(m) => setDepMatrix(ensureRelation(names, m))}
                    locked={locked}
                    setLocked={setLocked}
                    onInfer={inferHybrid}
                    dag={dagStatus.dag}
                  />
                )}

                {/* Actions */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-3 mt-8">
                  <button
                    onClick={() => setFields(p => [...p, { name: '', description: '', useAI: true }])}
                    className="px-5 py-3 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl font-semibold text-slate-500 hover:bg-white/70 dark:hover:bg-slate-800/70 transition flex items-center gap-2"
                    type="button"
                  >
                    <Plus size={18} /> Add field
                  </button>

                  <div className="flex items-center gap-3">
                    <button onClick={() => setStep(1)} className="mac-ghost" type="button">
                      <span className="inline-flex items-center gap-2"><ArrowLeft size={18} /> Back</span>
                    </button>
                    <button
                      onClick={() => generate()}
                      disabled={loading || !fields.some(f => f.name.trim())}
                      className="mac-primary disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Generate and analyze"
                    >
                      <span className="inline-flex items-center gap-2">
                        {loading ? 'Generating 20 Rows…' : 'Generate & Analyze'} <Play size={18} />
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Analyze */}
            {step === 3 && (
              <AnalyzePanel
                rows={rows}
                setRows={setRows}
                reasoning={reasoning}
                chartSuggestions={chartSuggestions}
                chartGlobalReasoning={chartGlobalReasoning}
                tableSuggestions={tableSuggestions}
                downloadCSV={downloadCSV}
                onBackToSettings={() => setStep(2)}
                onApplyTableSuggestion={handleApplyTableSuggestion}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}