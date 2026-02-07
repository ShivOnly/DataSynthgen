'use client';

import { useEffect, useRef } from 'react';

/**
 * iOS-style glass Header
 * - Keeps “DataSynth.जनन”
 * - Bolder, crisper, iOS-like gradient & separators
 * - Indents content by live sidebar width (--sidebar-w) so it never overlaps the rail
 * - Exposes --app-header-h for page offset
 */
export default function Header() {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const headerEl = ref.current;
    if (!headerEl) return;

    const root = document.documentElement;

    /** Maintain header height var for page layout */
    const setHeaderHeightVar = () => {
      root.style.setProperty('--app-header-h', `${headerEl.offsetHeight || 0}px`);
    };
    const headerRO = new ResizeObserver(setHeaderHeightVar);
    headerRO.observe(headerEl);
    setHeaderHeightVar();

    /** Sidebar width -> --sidebar-w */
    const pickSidebar = () =>
      document.getElementById('app-sidebar') ||
      document.querySelector<HTMLElement>('.sidebar-rail') ||
      null;

    let sidebarEl: HTMLElement | null = pickSidebar();

    const setSidebarWidthVar = () => {
      const w = sidebarEl ? sidebarEl.getBoundingClientRect().width : 0;
      root.style.setProperty('--sidebar-w', `${Math.max(0, Math.round(w))}px`);
    };

    let attempts = 0;
    const maxAttempts = 60; // ~1s across frames
    const bindSidebar = () => {
      if (!sidebarEl) sidebarEl = pickSidebar();
      if (sidebarEl) {
        setSidebarWidthVar();
        sidebarRO.observe(sidebarEl);
      } else if (attempts++ < maxAttempts) {
        requestAnimationFrame(bindSidebar);
      }
    };

    const sidebarRO = new ResizeObserver(setSidebarWidthVar);
    requestAnimationFrame(bindSidebar);

    const onWinResize = () => {
      setHeaderHeightVar();
      setSidebarWidthVar();
    };
    window.addEventListener('resize', onWinResize);

    return () => {
      headerRO.disconnect();
      sidebarRO.disconnect();
      window.removeEventListener('resize', onWinResize);
    };
  }, []);

  return (
    <header
      ref={ref}
      className="
        fixed inset-x-0 top-0 z-40
        border-b border-white/20 dark:border-white/10
        backdrop-blur-xl
      "
      // iOS-like blue glass gradient background
      style={{
        background:
          'linear-gradient(180deg, rgba(14, 26, 56, 0.85) 0%, rgba(14, 26, 56, 0.72) 55%, rgba(14, 26, 56, 0.60) 100%)',
      }}
    >
      {/* A faint separator line like iOS */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 40%, rgba(255,255,255,0.25) 60%, transparent 100%)',
        }}
      />

      {/* Inner content indented by sidebar width */}
      <div
        className="w-full px-4 md:px-6"
        style={{
          marginLeft: 'var(--sidebar-w, 0px)',
          maxWidth: 'calc(100vw - var(--sidebar-w, 0px))',
          transition: 'margin-left 240ms cubic-bezier(0.24, 0.8, 0.2, 1)',
        }}
      >
        <div className="max-w-7xl mx-auto py-2.5 md:py-3">
          {/* Small badge */}
          <div className="flex justify-center">
            <span
              className="
                inline-flex items-center gap-1
                px-3 py-0.5 rounded-full
                text-[10.5px] font-semibold
                border
              "
              style={{
                color: 'rgba(185, 210, 255, 0.95)',
                background:
                  'linear-gradient(180deg, rgba(10,132,255,0.22) 0%, rgba(10,132,255,0.16) 100%)',
                borderColor: 'rgba(135, 170, 255, 0.35)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)',
              }}
            >
              DATA GENERATOR
            </span>
          </div>

          {/* Title */}
          <div className="mt-2 flex justify-center">
            <h1
              className="
                leading-none text-center
                tracking-tight
              "
              style={{
                fontSize: 'clamp(26px, 2.1vw, 32px)',
                fontWeight: 800,
                letterSpacing: '-0.01em',
                color: 'white',
                textShadow: '0 1px 8px rgba(0,0,0,0.35)',
              }}
            >
              <span>DataSynth</span>
              <span
                className="ml-1"
                style={{
                  color: '#7CC2FF', // iOS aqua-blue tint
                  textShadow: '0 1px 10px rgba(124,194,255,0.35)',
                  fontWeight: 800,
                }}
              >
                .जनन
              </span>
            </h1>
          </div>

          {/* Subtitle */}
          <div className="mt-1 flex justify-center">
            <p
              className="text-center"
              style={{
                fontSize: 'clamp(12px, 1.3vw, 15px)',
                color: 'rgba(220,230,255,0.9)',
                textShadow: '0 1px 6px rgba(0,0,0,0.3)',
                maxWidth: 840,
              }}
            >
              <b>Generate high-fidelity datasets</b>
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}