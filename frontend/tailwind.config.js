/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // DefiLlama-inspired color scheme
        primary: {
          DEFAULT: '#4F46E5',
          dark: '#4338CA',
          light: '#6366F1',
        },
        dark: {
          bg: '#0D1117',
          surface: '#161B22',
          border: '#30363D',
          text: '#C9D1D9',
          muted: '#8B949E',
        },
        light: {
          bg: '#FFFFFF',
          surface: '#F6F8FA',
          border: '#D0D7DE',
          text: '#24292F',
          muted: '#57606A',
        },
        yield: {
          low: '#22C55E',
          medium: '#EAB308',
          high: '#F97316',
          extreme: '#EF4444',
        },
        risk: {
          low: '#22C55E',
          moderate: '#3B82F6',
          high: '#F97316',
          extreme: '#EF4444',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(79, 70, 229, 0.5)' },
          '100%': { boxShadow: '0 0 20px rgba(79, 70, 229, 0.8)' },
        },
      },
    },
  },
  plugins: [],
}
