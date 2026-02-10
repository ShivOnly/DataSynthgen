'use client';

import {
  History,
  Database,
  Clock,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import type { HistoryItem } from '../types';
import Image from 'next/image';
import { useEffect, useMemo } from 'react';

interface SidebarProps {
  history: HistoryItem[];
  isCollapsed: boolean;
  onToggle: () => void;
  onSelect: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
}

/**
 * mac‑style Sidebar (full height)
 * - COLLAPSED: only logo (top) + PFP (bottom)
 * - EXPANDED: glassy rail + title + history list + delete controls
 * - Toggle remains fully inside the rail
 * - Always sets --sidebar-w so Header can align perfectly.
 */
export default function Sidebar({
  history,
  onSelect,
  onDelete,
  isCollapsed,
  onToggle,
}: SidebarProps) {
  // TUNE these widths to your taste
  const COLLAPSED_W = 64;  // was 76
  const EXPANDED_W  = 232; // was 264

  const width = isCollapsed ? COLLAPSED_W : EXPANDED_W;
  const widthClass = isCollapsed ? `w-[${COLLAPSED_W}px]` : `w-[${EXPANDED_W}px]`;

  // Keep Header aligned by updating global CSS variables
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--sidebar-w', `${width}px`);
    root.style.setProperty('--sidebar-gutter', '12px'); // tweak if you want more breathing room
  }, [width]);

  const emptyState = useMemo(
    () => (
      <div className="mt-10 text-center text-[12px] text-slate-500 dark:text-slate-400 px-2">
        <div className="mx-auto mb-2 h-9 w-9 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 flex items-center justify-center shadow-sm">
          <History size={16} />
        </div>
        No generations yet
      </div>
    ),
    [],
  );

  return (
    <aside
      id="app-sidebar"
      className={[
        'fixed left-0 top-0 z-50', // ABOVE header (header z-40)
        'h-screen',
        'sidebar-rail',
        'backdrop-blur-xl',
        'bg-white/60 dark:bg-slate-900/55',
        'border-r border-slate-200/60 dark:border-slate-800/50',
        'flex flex-col',
        'transition-all duration-300',
        widthClass,
      ].join(' ')}
      style={{
        width,
        // Make sure nothing inside gets visually clipped by the rail
        overflow: 'visible',
      }}
      aria-label="Sidebar"
    >
      {/* Top strip: logo + inside toggle */}
      <div
  className="
    border-b border-slate-200/60 dark:border-slate-800/60
    px-3
  "
  style={{
    height: '60px',                 // match header height
    display: 'flex',
    alignItems: 'center',           // vertical centering
    justifyContent: isCollapsed ? 'center' as const : 'space-between' as const,
  }}
>
  {/* Dataset logo + text */}
  <div className="flex items-center gap-2">
    <div className="h-9 w-9 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 flex items-center justify-center shadow-sm">
      <Database size={18} />
    </div>
    {!isCollapsed && (
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 leading-none">
          Generation History
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-none mt-1">
          Recent datasets
        </div>
      </div>
    )}
  </div>

  {/* Toggle */}
  <button
    onClick={onToggle}
    className="
      ml-2 shrink-0
      rounded-lg border border-slate-300/70 dark:border-slate-700/60
      bg-white/80 dark:bg-slate-900/70
      hover:bg-white dark:hover:bg-slate-800
      px-2 py-1 transition
    "
    aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    title={isCollapsed ? 'Expand' : 'Collapse'}
  >
    {isCollapsed ? (
      <ChevronRight size={16} className="text-slate-500" />
    ) : (
      <ChevronLeft size={16} className="text-slate-500" />
    )}
  </button>
</div>

      {/* History List (hidden in collapsed mode) */}
      <div className={`thin-scrollbar flex-1 overflow-y-auto ${isCollapsed ? 'hidden' : 'block'}`}>
        <div className="p-3 space-y-2">
          {history.length === 0 && emptyState}

          {history.map((item) => (
            <div
              key={item.id}
              onClick={() => onSelect(item)}
              className="
                group relative cursor-pointer
                rounded-xl border border-transparent
                hover:bg-white/70 dark:hover:bg-slate-900/55
                hover:border-slate-200/70 dark:hover:border-slate-800/70
                transition-colors
                px-3 py-2.5
                flex items-center gap-3
              "
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelect(item);
              }}
            >
              <div className="h-2.5 w-2.5 rounded-full bg-blue-500/80 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200 truncate">
                  {item.description}
                </p>
                <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                  <Clock size={11} />
                  <span className="truncate">{item.timestamp}</span>
                </div>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(item.id);
                }}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-red-500"
                aria-label="Delete history item"
                title="Delete"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Footer: PFP only in collapsed; details in expanded */}
      <div
        className="
          px-3 py-3
          bg-white/65 dark:bg-slate-900/55
          border-t border-slate-200/60 dark:border-slate-800/60
          mt-auto
        "
      >
        <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''}`}>
          <Image
            src="/shiv.png"
            alt="Profile"
            width={36}
            height={36}
            className="h-9 w-9 rounded-full object-cover ring-2 ring-white/60 dark:ring-slate-900/60"
          />
          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200 truncate">Tester</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">user environment</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
