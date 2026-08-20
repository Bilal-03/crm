/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./crm-system.jsx"
  ],
  darkMode: 'class',
  future: {
    // Prevent touch browsers from treating the first tap as a persistent hover.
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
      colors: {
        indigo: {
          50: '#effcf9',
          100: '#dff8f3',
          200: '#b8eee5',
          300: '#7ddfd2',
          400: '#3bc9b7',
          500: '#14b8a6',
          600: '#0f766e',
          700: '#0b5f59',
          800: '#115e59',
          900: '#134e4a',
          950: '#042f2e',
        },
      },
    },
  },
  plugins: [],
}
