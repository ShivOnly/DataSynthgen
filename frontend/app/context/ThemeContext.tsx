'use client';
 
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
 
type Theme = 'light' | 'dark';
type ThemeContextValue = { theme: Theme; toggleTheme: () => void };
 
const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggleTheme: () => {},
});
 
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [theme, setTheme] = useState<Theme>('light');
  const [mounted, setMounted] = useState(false);
 
  /** Apply theme globally (imperceptible switch) */
  const apply = (t: Theme) => {
    const root = document.documentElement;
 
    // 1) Disable transitions for this paint so the flip feels instant
    root.classList.add('theme-switching');
 
    // 2) Tailwind dark trigger
    root.classList.toggle('dark', t === 'dark');
 
    // 3) Optional: attribute trigger for any CSS that reads it
    if (t === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
 
    // 4) Safety: remove any rogue `.dark` on descendants
    document
      .querySelectorAll(':not(html).dark')
      .forEach((el) => el.classList.remove('dark'));
 
    // 5) Re-enable transitions on the next frame
    // (so normal UI interactions keep their own transitions)
    requestAnimationFrame(() => {
      root.classList.remove('theme-switching');
    });
  };
 
  // Initial load: read saved theme (or default to light)
  useEffect(() => {
    const saved = (localStorage.getItem('theme') as Theme | null) ?? 'light';
    setTheme(saved);
    apply(saved);
    setMounted(true);
  }, []);
 
  // Re-apply on theme changes
  useEffect(() => {
    if (!mounted) return;
    apply(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, mounted]);
 
  const toggleTheme = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('theme', next);
    apply(next);
  };
 
  const value = useMemo(() => ({ theme, toggleTheme }), [theme]);
 
  if (!mounted) return null; // prevents hydration flash
 
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
 
export const useTheme = () => useContext(ThemeContext);