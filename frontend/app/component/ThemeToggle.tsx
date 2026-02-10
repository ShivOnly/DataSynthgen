'use client';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export default function ThemeToggle({ variant = 'chip' }: { variant?: 'chip' | 'bare' }) {
  const { theme, toggleTheme } = useTheme();

  const wrapperClass =
    variant === 'chip'
      ? `
        flex items-center gap-2
        bg-white dark:bg-slate-900
        p-1 rounded-full
        border border-slate-200 dark:border-slate-800
        shadow-sm
      `
      : `
        flex items-center gap-2
      `;

  return (
    <div className={wrapperClass.trim()}>
      <Sun
        size={16}
        className={theme === 'light' ? 'text-blue-600' : 'text-slate-400'}
      />
      <button
        onClick={toggleTheme}
        className="
          relative w-10 h-5
          bg-slate-200 dark:bg-slate-700
          rounded-full transition-all duration-300
        "
        type="button"
        aria-label="Toggle theme"
        aria-pressed={theme === 'dark'}
      >
        <div
          className={`
            absolute top-0.5 left-0.5 w-4 h-4
            bg-white dark:bg-blue-500
            rounded-full shadow-sm transition-transform duration-300
            ${theme === 'dark' ? 'translate-x-5' : ''}
          `}
        />
      </button>
      <Moon
        size={16}
        className={theme === 'dark' ? 'text-blue-400' : 'text-slate-400'}
      />
    </div>
  );
}