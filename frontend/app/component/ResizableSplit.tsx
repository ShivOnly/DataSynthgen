'use client';

import React, { useEffect, useRef, useState } from 'react';

interface Props {
  initialLeftPercent?: number; // 0..100
  leftMin?: number;            // px
  rightMin?: number;           // px
  left: React.ReactNode;
  right: React.ReactNode;
}

export default function ResizableSplit({
  initialLeftPercent = 50,
  leftMin = 360,
  rightMin = 360,
  left,
  right,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [leftPx, setLeftPx] = useState<number | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const initial = Math.max(leftMin, Math.min(w - rightMin, Math.round((initialLeftPercent / 100) * w)));
    setLeftPx(initial);
  }, [initialLeftPercent, leftMin, rightMin]);

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const w = rect.width;
      let next = ev.clientX - rect.left;
      next = Math.max(leftMin, Math.min(w - rightMin, next));
      setLeftPx(next);
    };
    const onUp = () => { draggingRef.current = false; document.body.style.cursor = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [leftMin, rightMin]);

  const startDrag = () => { draggingRef.current = true; document.body.style.cursor = 'col-resize'; };

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      {leftPx !== null && (
        <>
          {/* Left pane */}
          <div className="absolute top-0 left-0 h-full overflow-hidden" style={{ width: leftPx }}>
            <div className="h-full">{left}</div>
          </div>

          {/* Handle */}
          <div
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize"
            onMouseDown={startDrag}
            className="absolute top-0 h-full w-2 cursor-col-resize group"
            style={{ left: leftPx - 4 }} // center a bit over the edge
          >
            <div className="h-full w-[2px] mx-auto bg-slate-200 dark:bg-slate-700 group-hover:bg-slate-400 dark:group-hover:bg-slate-500 transition" />
            <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 h-8 w-1.5 rounded-full bg-slate-300/60 dark:bg-slate-600/60 opacity-0 group-hover:opacity-100 transition" />
          </div>

          {/* Right pane */}
          <div
            className="absolute top-0 right-0 h-full overflow-hidden"
            style={{ left: leftPx, width: `calc(100% - ${leftPx}px)` }}
          >
            <div className="h-full">{right}</div>
          </div>
        </>
      )}
    </div>
  );
}