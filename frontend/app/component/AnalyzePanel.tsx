'use client';

import { useEffect, useMemo, useRef } from 'react';
import ResizableSplit from './ResizableSplit';
import ChartsPanel, { ChartSuggestion } from './ChartsPanel';

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
const VISIBLE_ROWS = 12;
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

  // ---------- LEFT PANE ----------
  const LeftPane = (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Title */}
      <div className="mb-3">
        <h1 className="text-[22px] md:text-[26px] font-semibold tracking-[-0.01em] text-slate-900 dark:text-slate-100">
          Dataset
        </h1>
        <p className="text-[14px] text-slate-500 dark:text-slate-400 mt-1">
          Edit cells inline. Changes are kept locally.
        </p>
      </div>

      {/* Top horizontal scrollbar (thin) */}
      <div
        ref={topScrollRef}
        className="thin-scrollbar w-full overflow-x-auto overflow-y-hidden border border-slate-200/70 dark:border-slate-800/70 rounded-lg mb-1"
        style={{ height: 8 }}
        title="Horizontal scroll (top)"
      />

      {/* Table container (glassy card) */}
      <div
        ref={bottomScrollRef}
        className="thin-scrollbar mac-card overflow-auto"
        style={{ maxHeight: tableMaxHeight }}
      >
        <div ref={tableInnerRef} className="inline-block min-w-full align-top">
          <table className="w-full text-[14px] text-left" style={{ tableLayout: 'auto' }}>
            <thead className="bg-slate-50/70 dark:bg-slate-800/60 border-b dark:border-slate-700 sticky top-0 z-10">
              <tr>
                {columns.map((k) => (
                  <th
                    key={k}
                    className="px-3 py-2.5 font-semibold text-[13px] tracking-wide border-r dark:border-slate-700 whitespace-nowrap text-slate-700 dark:text-slate-200"
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
                  className="border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors"
                  style={{ height: ROW_HEIGHT }}
                >
                  {columns.map((k) => {
                    const v = row[k];
                    return (
                      <td
                        key={k}
                        className="px-3 py-2 border-r dark:border-slate-800 align-top"
                        style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 560 }}
                        title={String(v ?? '')}
                      >
                        <input
                          className="w-full bg-transparent outline-none text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                          style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
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

      {/* Footer actions */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={downloadCSV} className="mac-primary" type="button">
            Download CSV
          </button>
          <button onClick={onBackToSettings} className="mac-ghost" type="button">
            Back to Settings
          </button>
        </div>
      </div>

      {/* Compact info row */}
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 min-h-[110px]">
        <div className="mac-card p-4 overflow-auto">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-[15px] mb-2">
            Dataset Reasoning
          </h3>
          <p className="text-[13px] text-slate-600 dark:text-slate-400 leading-relaxed">
            {reasoning || 'Reasoning appears here after generation or schema requests.'}
          </p>
        </div>

        <div className="mac-card p-4 overflow-auto">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-[15px] mb-3">
            Table Suggestions
          </h3>
          <div className="flex flex-col gap-2">
            {(tableSuggestions || []).slice(0, 3).map((s, i) => (
              <button
                key={i}
                onClick={() => onApplyTableSuggestion(s)}
                className="px-3 py-2 text-left text-[13px] border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition text-slate-700 dark:text-slate-200"
                type="button"
              >
                {s || '(empty)'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // ---------- RIGHT PANE ----------
  const RightPane = (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="thin-scrollbar mac-card flex-1 p-5 overflow-auto">
        <ChartsPanel data={rows} suggestions={chartSuggestions} globalReasoning={chartGlobalReasoning} />
      </div>
    </div>
  );

  return (
    <div style={{ height: 'calc(100vh - var(--app-header-h, 72px) - 24px)' }}>
      <ResizableSplit
        initialLeftPercent={56}
        leftMin={420}
        rightMin={420}
        left={LeftPane}
        right={RightPane}
      />
    </div>
  );
}