/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class', // ThemeProvider toggles <html class="dark">
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './pages/**/*.{js,ts,jsx,tsx,mdx}',      // OK if you have pages/, otherwise harmless
    './components/**/*.{js,ts,jsx,tsx,mdx}', // keep if you ALSO have /components
    './component/**/*.{js,ts,jsx,tsx,mdx}',  // YOUR folder (singular) — IMPORTANT
  ],
  theme: { extend: {} },
  plugins: [],
};