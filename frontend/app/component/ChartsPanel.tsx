'use client';

import React, { useMemo } from 'react';

/** ---------- Types ---------- */
export type ChartSuggestion = {
  id?: string;
  type: 'BAR' | 'LINE' | 'AREA' | 'SCATTER' | 'PIE' | 'RADAR' | 'COMPOSED' | string;
  title: string;
  subtitle?: string;
  aggregateLabel?: string; // e.g., 'sum', 'avg', etc.
};

interface ChartsPanelProps {
  data: Record<string, unknown>[];
  suggestions: ChartSuggestion[];
  globalReasoning: string;

  /** Renders on the right side of the "Suggested Charts" header.
   *  Use it to pass the "Back to Settings" pill from AnalyzePanel.
   */
  headerRight?: React.ReactNode;

  /** Optional: handle "Apply" on a suggestion */
  onApplySuggestion?: (s: ChartSuggestion) => void;
}

/** ---------- Component ---------- */
export default function ChartsPanel({
  data,
  suggestions,
  globalReasoning,
  headerRight,
  onApplySuggestion,
}: ChartsPanelProps) {
  const columns = useMemo(() => (data?.length ? Object.keys(data[0]) : []), [data]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-5">
      {/* LEFT: Chart Builder / Preview (replace this block with your existing builder UI) */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 min-h-[420px]">
        {/* Chart type tabs (example) */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {['BAR', 'LINE', 'AREA', 'SCATTER', 'PIE', 'RADAR', 'COMPOSED'].map((t) => (
            <button
              key={t}
              type="button"
              className="
                h-8 px-3 rounded-lg text-xs font-semibold
                bg-slate-800 text-slate-200
                hover:bg-slate-700 hover:text-white
                transition
              "
            >
              {t}
            </button>
          ))}
        </div>

        {/* Simple controls row (placeholder) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-slate-400">X Axis / Category</label>
            <select
              className="
                h-9 rounded-lg bg-slate-900/70 border border-slate-800
                text-sm text-slate-200 px-2
                focus:outline-none focus:ring-1 focus:ring-slate-600
              "
              defaultValue={columns[0] ?? ''}
            >
              {columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-slate-400">Group By (optional)</label>
            <select
              className="
                h-9 rounded-lg bg-slate-900/70 border border-slate-800
                text-sm text-slate-200 px-2
                focus:outline-none focus:ring-1 focus:ring-slate-600
              "
              defaultValue=""
            >
              <option value="">(none)</option>
              {columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Preview area (placeholder) */}
        <div className="h-[320px] rounded-xl border border-slate-800 bg-slate-900/40" />
      </section>

      {/* RIGHT: Suggested Charts */}
      <aside className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        {/* Header row with right-aligned slot */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-100 text-[15px] flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-slate-300" aria-hidden />
            Suggested Charts
          </h3>

          {/* Render the button passed from AnalyzePanel */}
          {headerRight}
        </div>

        {/* Optional global reasoning */}
        {globalReasoning ? (
          <p className="text-[12px] text-slate-400 mb-3">{globalReasoning}</p>
        ) : null}

        {/* Suggestions list */}
        <div className="space-y-3">
          {suggestions?.map((sugg, idx) => (
            <div
              key={sugg.id ?? idx}
              className="rounded-xl border border-slate-800 bg-slate-900/50 p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] uppercase tracking-wide text-slate-300 px-2 py-1 rounded-md bg-slate-800">
                  {sugg.type}
                </span>
                {sugg.aggregateLabel ? (
                  <span className="text-[11px] text-slate-400">{sugg.aggregateLabel}</span>
                ) : null}
              </div>

              <div className="text-slate-100 text-[14px] font-medium">{sugg.title}</div>
              {sugg.subtitle ? (
                <div className="text-[12px] text-slate-400 mt-1">{sugg.subtitle}</div>
              ) : null}

              <button
                type="button"
                onClick={() => onApplySuggestion?.(sugg)}
                className="
                  mt-3 w-full h-8 rounded-md
                  bg-slate-200 text-slate-900 text-[13px] font-semibold
                  hover:bg-white transition
                "
              >
                Apply
              </button>
            </div>
          ))}

          {!suggestions?.length && (
            <div className="text-[13px] text-slate-400">No suggestions yet.</div>
          )}
        </div>
      </aside>
    </div>
  );
}
