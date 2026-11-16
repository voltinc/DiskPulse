import type { Config } from 'tailwindcss';

// Design tokens measured from the reference screenshot: a Windows 11 dark-mode desktop app.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        win: '#1c1c1c', // window background
        pane: '#202020', // left navigation pane
        panel: '#272727', // cards in the content area
        bar: '#2b2b2b', // toolbar
        field: '#1a1a1a', // inputs and progress tracks
        line: '#363636', // separators
        hover: '#333333',
        active: '#3b4452', // pressed / selected toolbar button
        ink: '#f2f2f2',
        'ink-2': '#b6b6b6',
        'ink-3': '#8c8c8c',
        accent: '#3d8ee8',
        'accent-strong': '#1f78d1',
        danger: '#e0483e',
        good: '#27a85d',
        warn: '#e3c52a',
      },
      fontFamily: {
        sans: [
          '"Segoe UI Variable Text"',
          '"Segoe UI Variable"',
          '"Segoe UI"',
          'system-ui',
          '-apple-system',
          'Cantarell',
          '"Noto Sans"',
          'sans-serif',
        ],
      },
      fontSize: { base: ['13px', '18px'], xs: ['11.5px', '16px'], sm: ['12.5px', '17px'] },
      borderRadius: { card: '6px' },
    },
  },
  plugins: [],
} satisfies Config;
