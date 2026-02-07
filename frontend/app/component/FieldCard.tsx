'use client';

import { useId, useMemo } from 'react';
import { Link2 } from 'lucide-react';

export interface FieldCardData {
  name: string;
  description?: string;
  useAI: boolean;
}

interface FieldCardProps {
  index: number;
  data: FieldCardData;
  editable?: boolean;
  onUpdate: (index: number, key: 'name' | 'description' | 'useAI', value: string | boolean) => void;

  /** Parents for THIS field (derived from matrix by index). */
  dependencies?: string[];
}

/**
 * Single-row FieldCard (lg+): Name → Dependency → Source → Description.
 * The dependency banner is driven by `dependencies` prop passed from Studio (by index).
 */
export default function FieldCard({
  index,
  data,
  editable,
  onUpdate,
  dependencies,
}: FieldCardProps) {
  const nameId = useId();
  const descId = useId();
  const disabled = editable === false;

  const deps = useMemo(
    () => (Array.isArray(dependencies) ? dependencies.filter(Boolean) : []),
    [dependencies],
  );
  const hasDeps = deps.length > 0;

  return (
    <div
      className="
        grid gap-3
        lg:grid-cols-12
        items-start
      "
    >
      {/* Field name (lg: 3) */}
      <div className="lg:col-span-3">
        <label
          htmlFor={nameId}
          className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-200 mb-1"
        >
          Field name
        </label>
        <input
          id={nameId}
          type="text"
          className="w-full mac-input px-3 py-2.5 text-[15px] font-semibold placeholder:text-slate-400"
          placeholder="e.g., student_id"
          value={data.name}
          disabled={disabled}
          onChange={(e) => onUpdate(index, 'name', e.target.value)}
        />
      </div>

      {/* Dependency (lg: 4) */}
      <div className="lg:col-span-4">
        <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-200 mb-1">
          Dependency
        </label>

        {/* Single-row summary with horizontal scroll if long */}
        <div
          className="
            mac-input px-2.5 py-2
            bg-blue-50/70 dark:bg-blue-900/20
            border-blue-200/70 dark:border-blue-700/30
            overflow-x-auto whitespace-nowrap thin-scrollbar
            text-[13px] font-semibold
          "
          title={hasDeps ? `Depends on: ${deps.join(', ')}` : 'Independent'}
        >
          {hasDeps ? (
            <>
              <span className="inline-flex items-center gap-1 text-blue-800 dark:text-blue-200">
                <Link2 size={14} /> Dependent on:
              </span>
              {deps.map((d) => (
                <span
                  key={d}
                  className="
                    ml-2 inline-flex items-center px-2 py-0.5
                    rounded-md border
                    bg-white/80 dark:bg-slate-900/40
                    border-blue-200/70 dark:border-blue-700/30
                    text-blue-700 dark:text-blue-300
                  "
                >
                  {d}
                </span>
              ))}
            </>
          ) : (
            <span className="inline-flex items-center gap-1 text-blue-800 dark:text-blue-200">
              <Link2 size={14} /> Independent
            </span>
          )}
        </div>
      </div>

      {/* Source (lg: 2) */}
      <div className="lg:col-span-2">
        <label className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-200 mb-1">
          Source
        </label>
        <div
          className="inline-flex items-center rounded-lg border border-slate-300/70 dark:border-slate-700/60 overflow-hidden"
          role="group"
          aria-label="Field source"
        >
          <button
            type="button"
            className={[
              'px-3.5 py-2 text-[12.5px] font-semibold',
              data.useAI
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-white/70 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300',
            ].join(' ')}
            onClick={() => onUpdate(index, 'useAI', true)}
            aria-pressed={data.useAI}
            disabled={disabled}
            title="AI will propose values"
          >
            AI
          </button>
          <button
            type="button"
            className={[
              'px-3.5 py-2 text-[12.5px] font-semibold',
              !data.useAI
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-white/70 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300',
            ].join(' ')}
            onClick={() => onUpdate(index, 'useAI', false)}
            aria-pressed={!data.useAI}
            disabled={disabled}
            title="You will enter values manually"
          >
            Web
          </button>
        </div>
      </div>

      {/* Description (lg: 3) */}
      <div className="lg:col-span-3">
        <label
          htmlFor={descId}
          className="block text-[13.5px] font-semibold text-slate-700 dark:text-slate-200 mb-1"
        >
          Description <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <input
          id={descId}
          type="text"
          className="w-full mac-input px-3 py-2.5 text-[14.5px] font-medium placeholder:text-slate-400"
          placeholder="e.g., Unique student identifier"
          value={data.description || ''}
          disabled={disabled}
          onChange={(e) => onUpdate(index, 'description', e.target.value)}
        />
      </div>
    </div>
  );
}