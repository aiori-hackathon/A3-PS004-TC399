/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: { bg: '#090d13', panel: '#0e141c', panel2: '#121a24', line: '#1d2835', ink: '#d6dee8', mute: '#8fa0b3', faint: '#5d6e82', accent: '#38bdf8' },
    fontFamily: { mono: ['ui-monospace', '"Cascadia Mono"', '"SF Mono"', 'Consolas', 'Menlo', 'monospace'], sans: ['system-ui', '"Segoe UI"', 'Roboto', 'sans-serif'] },
  } },
  plugins: [],
};
