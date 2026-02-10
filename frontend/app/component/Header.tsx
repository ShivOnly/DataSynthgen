'use client';

import { useEffect, useRef, useState } from 'react';
import ThemeToggle from './ThemeToggle';

export default function Header() {
  const ref = useRef<HTMLElement | null>(null);
  const [hidden, setHidden] = useState(false);

  // Keep header height available via CSS var (for any sticky layout below)
  useEffect(() => {
    const headerEl = ref.current;
    if (!headerEl) return;

    const root = document.documentElement;
    const setHeight = () =>
      root.style.setProperty('--app-header-h', `${headerEl.offsetHeight}px`);

    const ro = new ResizeObserver(setHeight);
    ro.observe(headerEl);
    setHeight();

    return () => ro.disconnect();
  }, []);

  // Hide-on-scroll behavior (unchanged)
  useEffect(() => {
    const last = { y: window.scrollY };
    let ticking = false;

    const onScroll = () => {
      const y = window.scrollY;
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          if (y > last.y + 12 && y > 80) setHidden(true);
          else if (y < last.y - 12) setHidden(false);
          last.y = y;
          ticking = false;
        });
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      ref={ref}
      className="fixed inset-x-0 top-0 z-40 border-b border-white/10 backdrop-blur-xl"
      style={{
        height: '60px',
        background:
          'linear-gradient(180deg, rgba(14,26,56,0.85), rgba(14,26,56,0.72) 55%, rgba(14,26,56,0.60))',
        transform: hidden ? 'translateY(-110%)' : 'translateY(0)',
        transition: 'transform 200ms',
        // Avoid accidental clipping of any inner shadows/glows
        overflow: 'visible',
      }}
    >
      <div
        className="w-full h-full px-4 md:px-6 flex items-center justify-between"
        style={{
          /**
           * Park header content to the right of the current sidebar width.
           * We add a small gutter so the logo never kisses the rail edge.
           * `--sidebar-w` is set by Sidebar; `--sidebar-gutter` is optional (defaults to 12px).
           */
          paddingLeft: 'calc(var(--sidebar-w, 0px) + var(--sidebar-gutter, 12px))',
          maxWidth: '100vw',
          position: 'relative',
          zIndex: 1, // ensure above page content (rail is z-50)
        }}
      >
        {/* LEFT — LOGO */}
        <div className="leading-tight select-none" style={{ whiteSpace: 'nowrap' }}>
          <h1
            className="tracking-tight"
            style={{
              fontSize: '22px',
              fontWeight: 800,
              color: 'white',
              textShadow: '0 1px 4px rgba(0,0,0,0.3)',
              lineHeight: 1.1,
            }}
          >
            DataSynth
            <span
              className="ml-1"
              style={{
                color: '#7CC2FF',
                textShadow: '0 1px 6px rgba(124,194,255,0.35)',
              }}
            >
              .जनन
            </span>
          </h1>
          <p
            style={{
              marginTop: '1px',
              fontSize: '12px',
              color: 'rgba(220,230,255,0.9)',
              lineHeight: 1,
            }}
          >
            <b>Generate high-fidelity datasets</b>
          </p>
        </div>

        {/* RIGHT — Controls (Back removed, Theme label removed) */}
        <div className="flex items-center gap-2">
          <div
            className="
              h-10 px-2
              flex items-center
              rounded-xl
              border border-white/20
              bg-white/5
              text-white/90 text-sm
            "
          >
            <ThemeToggle variant="bare" />
          </div>
        </div>
      </div>
    </header>
  );
}