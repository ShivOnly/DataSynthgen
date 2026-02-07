// app/layout.tsx
import { ThemeProvider } from './context/ThemeContext';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata = {
  title: 'DataSynth.GEN',
  description: 'High-fidelity synthetic dataset generator',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Ensure theme is applied before first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function() {
  try {
    var stored = localStorage.getItem('theme'); // 'light' | 'dark' | null
    var mql = window.matchMedia('(prefers-color-scheme: dark)');
    var system = mql.matches ? 'dark' : 'light';
    var theme = stored || system;
    var add = function() {
      document.documentElement.classList.add('dark');
      if (document.body) document.body.classList.add('dark');
    };
    var remove = function() {
      document.documentElement.classList.remove('dark');
      if (document.body) document.body.classList.remove('dark');
    };
    if (theme === 'dark') add(); else remove();
  } catch (e) {}
})();
            `.trim(),
          }}
        />
        {/* Hint system accent for supported UAs */}
        <meta name="theme-color" content="#0A84FF" />
      </head>

      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased text-slate-900 dark:text-slate-100 transition-colors duration-500`}
      >
        {/* macOS blue background wrapper (keeps your body classes untouched) */}
        <div className="mac-app-bg">
          <ThemeProvider>{children}</ThemeProvider>
        </div>
      </body>
    </html>
  );
}