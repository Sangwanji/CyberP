import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        cyber: {
          bg: '#04110d',
          panel: '#071a15',
          panelAlt: '#0b241d',
          line: '#123528',
          accent: '#2efc97',
          accentSoft: '#1ddf84',
          text: '#d7ffe9',
          muted: '#7ba691',
        },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(46, 252, 151, 0.15), 0 20px 60px rgba(0, 0, 0, 0.45)',
      },
      backgroundImage: {
        'cyber-grid':
          'linear-gradient(rgba(46, 252, 151, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(46, 252, 151, 0.08) 1px, transparent 1px)',
      },
    },
  },
  plugins: [],
} satisfies Config;
