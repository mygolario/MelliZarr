/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        gold: {
          light: '#F3E5AB', // Glowing cream gold
          DEFAULT: '#D4AF37', // Pure gold
          dark: '#AA7C11', // Deep dark gold
          glow: '#FFD700', // Neon glowing gold
        },
        charcoal: {
          light: '#1F2833', // Deep gray-blue
          DEFAULT: '#0B0C10', // Pitch dark charcoal
          dark: '#050608', // Pure black-gray
        },
      },
      boxShadow: {
        'gold-glow': '0 0 15px rgba(212, 175, 55, 0.25)',
        'gold-glow-strong': '0 0 25px rgba(212, 175, 55, 0.5)',
      },
    },
  },
  plugins: [],
}
