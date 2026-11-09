/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: {
          950: '#0A130F',
          900: '#0F1E18',
          850: '#13261E',
          800: '#1A3329',
          700: '#23422F',
          600: '#2F5440',
          500: '#43705A',
        },
        ivory: {
          50: '#FCFAF4',
          100: '#F6F1E4',
          200: '#EAE3CF',
          300: '#D9CFB4',
          400: '#BDB293',
        },
        emerald: {
          300: '#A3CDB5',
          400: '#84B89B',
          500: '#63987E',
          600: '#4B7D64',
        },
        gold: {
          200: '#EFDDAA',
          300: '#DDC487',
          400: '#C9AB68',
          500: '#A88B4C',
          600: '#8A7038',
        },
        verdict: {
          secure: '#7FC79C',
          insecure: '#D9B66A',
          bogus: '#E0786A',
          blocked: '#A3ADA7',
          error: '#87958D',
        },
      },
      fontFamily: {
        display: ['"Fraunces"', 'Georgia', 'serif'],
        sans: ['"Instrument Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
