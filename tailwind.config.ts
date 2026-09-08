import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Arabic-first typography; falls back to system UI fonts.
        sans: ["var(--font-arabic)", "Tajawal", "system-ui", "sans-serif"],
      },
      colors: {
        // Neutral audit palette + severity semantics.
        brand: {
          // Calmer, slightly desaturated blue — less glare than the electric
          // 1d4ed8, while keeping white-on-brand contrast legible.
          50: "#eef4fb",
          100: "#dae7f6",
          500: "#4c82d6",
          600: "#3563bd",
          700: "#2b4f9c",
        },
        severity: {
          critical: "#dc2626",
          high: "#ea580c",
          medium: "#d97706",
          low: "#65a30d",
          info: "#0891b2",
        },
      },
      boxShadow: {
        card: "0 1px 3px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
