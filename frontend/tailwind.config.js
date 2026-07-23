/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#10201f",
        petrol: {
          600: "#0f5c5a",
          700: "#0b4a48",
          800: "#093a39",
        },
        signal: {
          viable: "#1a7f4b",
          analysis: "#b07a10",
          blocked: "#b3382f",
          offline: "#6b7280",
        },
      },
      fontFamily: {
        display: ["'Archivo'", "system-ui", "sans-serif"],
        body: ["'Archivo'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
