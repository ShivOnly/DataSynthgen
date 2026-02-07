'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  ScatterChart, Scatter, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart
} from 'recharts';
import { Wand2, Check, Layers } from 'lucide-react';

type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'radar' | 'composed';

export interface ChartSuggestion {
  chart_type: ChartType;
  x?: string | null;
  y: string[];
  group_by?: string | null;
  aggregation?: 'sum' | 'avg' | 'count' | null;
  reasoning: string;
  explanation: string;
}

interface Props {
  data: any[];
  suggestions: ChartSuggestion[];
  globalReasoning?: string;
}

function isNumericArray(vals: any[]) {
  return vals.every(v => v === null || v === '' || !isNaN(Number(String(v).replace(/,/g, ''))));
}

function detectNumericCols(rows: any[]) {
  if (!rows?.length) return [];
  const first = rows[0];
  return Object.keys(first).filter(k => isNumericArray(rows.map(r => r[k])));
}

function detectCategoricalCols(rows: any[]) {
  if (!rows?.length) return [];
  const first = rows[0];
  return Object.keys(first).filter(k => !isNumericArray(rows.map(r => r[k])));
}

function aggregateData(
  rows: any[],
  xKey: string | null | undefined,
  yKeys: string[],
  groupBy?: string | null,
  aggregation?: 'sum' | 'avg' | 'count' | null
) {
  if (!rows.length || (!xKey && !groupBy)) return rows;

  const groupKey = groupBy || xKey!;
  const grouped: Record<string, any[]> = {};
  rows.forEach(r => {
    const k = String(r[groupKey]);
    grouped[k] = grouped[k] || [];
    grouped[k].push(r);
  });

  const result: any[] = [];
  Object.entries(grouped).forEach(([k, arr]) => {
    const row: any = { [groupKey]: k };
    if (!yKeys.length) {  // count only
      row.value = arr.length;
    } else {
      yKeys.forEach(y => {
        const vals = arr.map(a => Number(String(a[y]).replace(/,/g, ''))).filter(v => !isNaN(v));
        if (!vals.length) {
          row[y] = 0;
          return;
        }
        switch (aggregation) {
          case 'avg':
            row[y] = vals.reduce((p, c) => p + c, 0) / vals.length;
            break;
          case 'count':
            row[y] = vals.length;
            break;
          case 'sum':
          default:
            row[y] = vals.reduce((p, c) => p + c, 0);
        }
      });
    }
    result.push(row);
  });
  return result;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16'];

export default function ChartsPanel({ data, suggestions, globalReasoning }: Props) {
  const numericCols = useMemo(() => detectNumericCols(data), [data]);
  const categoricalCols = useMemo(() => detectCategoricalCols(data), [data]);

  // defaults
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [xField, setXField] = useState<string | undefined>(categoricalCols[0]);
  const [yFields, setYFields] = useState<string[]>(numericCols.slice(0, 1));
  const [groupBy, setGroupBy] = useState<string | undefined>(undefined);
  const [aggregation, setAggregation] = useState<'sum' | 'avg' | 'count'>('sum');
  const [activeSuggestion, setActiveSuggestion] = useState<number | null>(null);
  const [reasoning, setReasoning] = useState<string>(globalReasoning || '');

  useEffect(() => {
    // reset when data changes
    setXField(categoricalCols[0]);
    setYFields(numericCols.slice(0, 1));
  }, [data]); // eslint-disable-line

  useEffect(() => {
    setReasoning(globalReasoning || '');
  }, [globalReasoning]);

  const aggData = useMemo(() => {
    if (['bar', 'line', 'area', 'composed'].includes(chartType)) {
      return aggregateData(data, xField, yFields, groupBy, aggregation);
    }
    if (chartType === 'pie') {
      // For pie, aggregate by a category and a single numeric field
      const y = yFields[0];
      const rows = aggregateData(data, xField, [y], xField, 'sum');
      return rows.map(r => ({ name: r[xField!], value: r[y] }));
    }
    return data;
  }, [data, chartType, xField, yFields, groupBy, aggregation]);

  const applySuggestion = (idx: number) => {
    const s = suggestions[idx];
    setChartType(s.chart_type);
    setXField(s.x || undefined);
    setYFields(s.y || []);
    setGroupBy(s.group_by || undefined);
    setAggregation((s.aggregation as any) || 'sum');
    setActiveSuggestion(idx);
    setReasoning([s.reasoning, s.explanation].filter(Boolean).join(' — '));
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl p-4">
        <div className="flex flex-wrap gap-2">
          {(['bar','line','area','scatter','pie','radar','composed'] as ChartType[]).map(t => (
            <button
              key={t}
              onClick={() => setChartType(t)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                chartType === t
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 hover:bg-slate-50'
              }`}
              type="button"
              title={`Use ${t} chart`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Axis selectors */}
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">X Axis / Category</label>
            <select
              className="w-full p-2 rounded-lg border-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              value={xField || ''}
              onChange={(e) => setXField(e.target.value || undefined)}
              disabled={chartType === 'scatter' || chartType === 'radar' || chartType === 'pie'}
            >
              <option value="">(none)</option>
              {categoricalCols.map(c => <option key={c} value={c}>{c}</option>)}
              {chartType !== 'pie' && numericCols.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Group By (optional)</label>
            <select
              className="w-full p-2 rounded-lg border-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              value={groupBy || ''}
              onChange={(e) => setGroupBy(e.target.value || undefined)}
              disabled={chartType === 'pie' || chartType === 'scatter'}
            >
              <option value="">(none)</option>
              {categoricalCols.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs text-slate-500 mb-1">Y Axis / Measures (choose one or more)</label>
            <div className="flex flex-wrap gap-2">
              {numericCols.map(n => {
                const selected = yFields.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      if (selected) setYFields(yFields.filter(y => y !== n));
                      else setYFields([...yFields, n]);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                      selected
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {selected && <Check size={14} className="inline mr-1" />} {n}
                  </button>
                );
              })}
            </div>
          </div>

          {['bar','line','area','composed'].includes(chartType) && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Aggregation</label>
              <select
                className="w-full p-2 rounded-lg border-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                value={aggregation}
                onChange={(e) => setAggregation(e.target.value as any)}
              >
                <option value="sum">Sum</option>
                <option value="avg">Average</option>
                <option value="count">Count</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl p-4 min-h-[320px]">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'bar' && (
              <BarChart data={aggData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={groupBy || xField || Object.keys(aggData?.[0] || {})[0]} />
                <YAxis />
                <Tooltip />
                <Legend />
                {(yFields.length ? yFields : ['value']).map((y, i) => (
                  <Bar key={y} dataKey={y} fill={COLORS[i % COLORS.length]} />
                ))}
              </BarChart>
            )}

            {chartType === 'line' && (
              <LineChart data={aggData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={groupBy || xField || Object.keys(aggData?.[0] || {})[0]} />
                <YAxis />
                <Tooltip />
                <Legend />
                {(yFields.length ? yFields : ['value']).map((y, i) => (
                  <Line key={y} type="monotone" dataKey={y} stroke={COLORS[i % COLORS.length]} dot={false} />
                ))}
              </LineChart>
            )}

            {chartType === 'area' && (
              <AreaChart data={aggData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={groupBy || xField || Object.keys(aggData?.[0] || {})[0]} />
                <YAxis />
                <Tooltip />
                <Legend />
                {(yFields.length ? yFields : ['value']).map((y, i) => (
                  <Area key={y} type="monotone" dataKey={y} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} />
                ))}
              </AreaChart>
            )}

            {chartType === 'pie' && (
              <PieChart>
                <Tooltip />
                <Legend />
                <Pie data={aggData} dataKey="value" nameKey="name" outerRadius={110} label>
                  {aggData.map((_: any, idx: number) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            )}

            {chartType === 'scatter' && (
              <ScatterChart>
                <CartesianGrid />
                <XAxis dataKey={yFields[0] || numericCols[0]} name={yFields[0] || numericCols[0]} />
                <YAxis dataKey={yFields[1] || numericCols[1]} name={yFields[1] || numericCols[1]} />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                <Legend />
                <Scatter name="Observations" data={data.map((d) => ({
                  [yFields[0] || numericCols[0]]: Number(d[yFields[0] || numericCols[0]]),
                  [yFields[1] || numericCols[1]]: Number(d[yFields[1] || numericCols[1]]),
                }))} fill={COLORS[0]} />
              </ScatterChart>
            )}

            {chartType === 'radar' && (
              <RadarChart
                data={(yFields.length ? yFields : numericCols.slice(0, 3)).map((y, i) => ({
                  metric: y,
                  value: data.slice(0, 50).map((r: any) => Number(r[y])).filter((v: number) => !isNaN(v))
                    .reduce((p: number, c: number, _, arr: number[]) => p + c/arr.length, 0)
                }))}
              >
                <PolarGrid />
                <PolarAngleAxis dataKey="metric" />
                <PolarRadiusAxis />
                <Radar name="Avg" dataKey="value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.4} />
                <Legend />
              </RadarChart>
            )}

            {chartType === 'composed' && (
              <ComposedChart data={aggData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={groupBy || xField || Object.keys(aggData?.[0] || {})[0]} />
                <YAxis />
                <Tooltip />
                <Legend />
                {(yFields.length ? yFields : ['value']).map((y, i) => (
                  i === 0
                    ? <Bar key={y} dataKey={y} fill={COLORS[i % COLORS.length]} />
                    : <Line key={y} type="monotone" dataKey={y} stroke={COLORS[i % COLORS.length]} />
                ))}
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {/* Suggestions */}
      {suggestions?.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Wand2 size={16} />
            <h4 className="font-semibold">Suggested Charts</h4>
          </div>
          <div className="flex flex-col gap-3">
            {suggestions.map((s, i) => (
              <div
                key={i}
                className={`p-3 rounded-xl border ${activeSuggestion === i ? 'border-blue-500' : 'border-slate-200 dark:border-slate-800'}`}
              >
                <div className="flex justify-between items-center">
                  <div className="text-sm">
                    <div className="font-semibold">{s.chart_type.toUpperCase()}</div>
                    <div className="text-xs text-slate-500">
                      x: {s.x || '—'}, y: {s.y?.join(', ') || '—'}, groupBy: {s.group_by || '—'}, agg: {s.aggregation || '—'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => applySuggestion(i)}
                    className="px-3 py-1.5 rounded-lg text-sm bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  >
                    Apply
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-2 italic">{s.reasoning}</p>
                <p className="text-xs text-slate-500 mt-1">{s.explanation}</p>
              </div>
            ))}
          </div>
          {reasoning && (
            <div className="mt-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300">
              <Layers className="inline mr-1" size={14} />
              <span>{reasoning}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}