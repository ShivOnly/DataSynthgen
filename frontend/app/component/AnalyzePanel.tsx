'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ChartsPanel, { ChartSuggestion } from './ChartsPanel';
import { ArrowLeft, Download } from 'lucide-react';

type Primitive = string | number | boolean | null | undefined;
export type Row = Record<string, Primitive>;

interface AnalyzePanelProps {
  rows: Row[];
  setRows: (rows: Row[] | ((prev: Row[]) => Row[])) => void;

  reasoning: string;
  chartSuggestions: ChartSuggestion[];
  chartGlobalReasoning: string;
  tableSuggestions: string[];

  downloadCSV: () => void;
  onBackToSettings: () => void;
  onApplyTableSuggestion: (suggestion: string) => void;
}

/** Mac‑like relaxed sizing */
const ROW_HEIGHT = 38;
const HEADER_HEIGHT = 48;
const VISIBLE_ROWS = 8;
const V_PADDING = 16;

export default function AnalyzePanel({
  rows,
  setRows,
  reasoning,
  chartSuggestions,
  chartGlobalReasoning,
  tableSuggestions,
  downloadCSV,
  onBackToSettings,
  onApplyTableSuggestion,
}: AnalyzePanelProps) {
  const hasData = rows && rows.length > 0;

  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const bottomScrollRef = useRef<HTMLDivElement | null>(null);
  const tableInnerRef = useRef<HTMLDivElement | null>(null);

  // Keep top and bottom horizontal scrollbars in sync
  useEffect(() => {
    const top = topScrollRef.current;
    const bottom = bottomScrollRef.current;
    if (!top || !bottom) return;

    const onTop = () => {
      if (bottom.scrollLeft !== top.scrollLeft) bottom.scrollLeft = top.scrollLeft;
    };
    const onBottom = () => {
      if (top.scrollLeft !== bottom.scrollLeft) top.scrollLeft = bottom.scrollLeft;
    };

    top.addEventListener('scroll', onTop);
    bottom.addEventListener('scroll', onBottom);
    return () => {
      top.removeEventListener('scroll', onTop);
      bottom.removeEventListener('scroll', onBottom);
    };
  }, []);

  // Fit an invisible filler inside the top scroll div so it matches table width
  const adjustTopBarWidth = () => {
    const top = topScrollRef.current;
    const inner = tableInnerRef.current;
    if (!top || !inner) return;
    top.innerHTML = '';
    const filler = document.createElement('div');
    filler.style.width = `${inner.scrollWidth}px`;
    filler.style.height = '1px';
    top.appendChild(filler);
  };
  useEffect(() => {
    const ro = new ResizeObserver(adjustTopBarWidth);
    if (tableInnerRef.current) ro.observe(tableInnerRef.current);
    adjustTopBarWidth();
    return () => ro.disconnect();
  }, [rows]);

  const columns = useMemo(() => (hasData ? Object.keys(rows[0]) : []), [hasData, rows]);
  const tableMaxHeight = HEADER_HEIGHT + VISIBLE_ROWS * ROW_HEIGHT + V_PADDING;

  // Parse reasoning into bullet points
  const reasoningBullets = useMemo(() => {
    if (!reasoning) return [];
    return reasoning
      .split(/[•\-\n]/)
      .map(b => b.trim())
      .filter(b => b.length > 0)
      .slice(0, 8);
  }, [reasoning]);

  const [activeView, setActiveView] = useState<'dataset' | 'charts'>('dataset');

  return (
    <div className="flex flex-col h-full overflow-hidden gap-6 p-6">
      {/* HEADER ROW: Title on the left, View Toggle on the right */}
      <div className="flex items-center justify-between">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em] text-slate-100">
          Dataset Analysis
        </h1>

        {/* VIEW TOGGLE (to the right of the title) */}
        <div className="inline-flex gap-1 p-1 bg-slate-800 rounded-lg border border-slate-700">
          <button
            onClick={() => setActiveView('dataset')}
            className={`px-4 py-2 rounded text-sm font-medium transition-all ${
              activeView === 'dataset'
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
            type="button"
          >
            Dataset
          </button>
          <button
            onClick={() => setActiveView('charts')}
            className={`px-4 py-2 rounded text-sm font-medium transition-all ${
              activeView === 'charts'
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
            type="button"
          >
            Charts &amp; Visualization
          </button>
        </div>
      </div>

      {/* DATASET VIEW */}
      {activeView === 'dataset' && (
        <div className="flex flex-col gap-6 flex-1 overflow-auto">
          {/* SECTION 1: TABLE WITH TOP BAR */}
          <div className="mac-card overflow-hidden flex flex-col">
            {/* Top Bar: SOLID DARK BG (no transparency) + higher z-index */}
            <div
              className="border-b border-slate-700 p-3 flex items-center justify-between gap-3"
              style={{
                backgroundColor: 'var(--panelTopBg, #0B1220)', // solid dark
                position: 'sticky',
                top: 0,
                zIndex: 15,
              }}
            >
              <div className="text-sm text-slate-300">
                {rows.length} {rows.length === 1 ? 'row' : 'rows'} • {columns.length}{' '}
                {columns.length === 1 ? 'column' : 'columns'}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={onBackToSettings}
                  className="mac-ghost text-sm flex items-center gap-2 text-slate-200 hover:text-white"
                  type="button"
                >
                  <ArrowLeft size={16} /> Back to Settings
                </button>
                <button
                  onClick={downloadCSV}
                  className="mac-primary text-sm py-2 px-3 flex items-center gap-2"
                  type="button"
                >
                  <Download size={16} /> Download CSV
                </button>
              </div>
            </div>

            {/* Optional top horizontal sync bar */}
            <div ref={topScrollRef} className="overflow-x-auto h-0" aria-hidden />

            {/* Table */}
            <div
              ref={bottomScrollRef}
              className="thin-scrollbar overflow-auto"
              style={{ maxHeight: tableMaxHeight }}
            >
              <div ref={tableInnerRef} className="inline-block min-w-full align-top">
                <table className="w-full text-[14px] text-left" style={{ tableLayout: 'auto' }}>
                  {/* THEAD: SOLID DARK BG + sticky + subtle shadow/border */}
                  <thead
                    className="border-b border-slate-700 sticky top-0"
                    style={{
                      backgroundColor: 'var(--tableHeadBg, #0E1626)', // solid dark head
                      zIndex: 10,
                      boxShadow: '0 1px 0 0 rgba(15, 23, 42, 0.6)',
                    }}
                  >
                    <tr>
                      {columns.map((k) => (
                        <th
                          key={k}
                          className="px-3 py-2.5 font-semibold text-[13px] tracking-wide border-r border-slate-800 whitespace-nowrap text-slate-200"
                        >
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {rows.map((row, i) => (
                      <tr
                        key={i}
                        className="border-b border-slate-800 hover:bg-slate-800/70 transition-colors"
                        style={{
                          height: ROW_HEIGHT,
                          backgroundColor: 'var(--rowBg, #0A1120)', // solid row background
                        }}
                      >
                        {columns.map((k) => {
                          const v = row[k];
                          return (
                            <td
                              key={k}
                              className="px-3 py-2 border-r border-slate-800 align-top text-slate-100"
                              style={{
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                maxWidth: 560,
                                backgroundColor: 'transparent',
                              }}
                              title={String(v ?? '')}
                            >
                              <input
                                className="w-full bg-transparent outline-none text-slate-100 placeholder:text-slate-400"
                                style={{
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                                value={String(v ?? '')}
                                onChange={(e) => {
                                  const newValue = e.target.value;
                                  setRows((prev) =>
                                    prev.map((r, idx) => (idx === i ? { ...r, [k]: newValue } : r)),
                                  );
                                }}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* SECTION 2: REASONING & TABLE SUGGESTIONS */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Reasoning (Left - larger) */}
            <div className="lg:col-span-2 mac-card p-5 overflow-auto">
              <h3 className="font-semibold text-slate-100 text-[15px] mb-4 flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-slate-100"></span>
                Dataset Reasoning
              </h3>
              {reasoningBullets.length > 0 ? (
                <ul className="space-y-2 text-[13px] text-slate-300 leading-relaxed">
                  {reasoningBullets.map((bullet, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-slate-500 flex-shrink-0">▪</span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-slate-400 italic">
                  Reasoning appears here after generation.
                </p>
              )}
            </div>

            {/* Table Suggestions (Right - sections) */}
            <div className="mac-card p-5 overflow-auto flex flex-col">
              <h3 className="font-semibold text-slate-100 text-[15px] mb-4 flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-slate-100"></span>
                Suggestions
              </h3>
              <div className="space-y-3 flex-1">
                {(tableSuggestions || []).slice(0, 4).map((s, i) => (
                  <div
                    key={i}
                    className="border border-slate-700 rounded-lg p-3 hover:bg-slate-800/60 transition cursor-pointer group"
                  >
                    <button
                      onClick={() => onApplyTableSuggestion(s)}
                      className="w-full text-left text-[13px] text-slate-200 font-medium group-hover:text-white transition"
                      type="button"
                      title={s}
                    >
                      {s || '(empty)'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CHARTS VIEW */}
      {activeView === 'charts' && (
        <div className="flex flex-col gap-6 flex-1 overflow-hidden">
          <div className="mac-card p-5 overflow-auto flex-1 min-h-0">
            <ChartsPanel
              data={rows}
              suggestions={chartSuggestions}
              globalReasoning={chartGlobalReasoning}
              /* 👇 This renders the button IN the Suggested Charts header, right-aligned */
              headerRight={
                <button
                  onClick={onBackToSettings}
                  className="
                    inline-flex items-center gap-1.5
                    rounded-full border border-white/10
                    bg-slate-900/80 text-slate-200
                    px-3 py-1.5 text-xs font-medium
                    shadow-sm backdrop-blur
                    hover:bg-slate-800 hover:text-white
                    transition
                  "
                  type="button"
                  aria-label="Back to Settings"
                  title="Back to Settings"
                >
                  <ArrowLeft size={14} />
                  Back to Settings
                </button>
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}
