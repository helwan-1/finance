import type { Config } from "tailwindcss";

const config: Config = {
  // Manual dark-mode toggle: the `dark` class on <html> drives every `dark:`
  // utility. A no-flash script resolves the saved choice (or the OS default)
  // into that class before paint (see theme-controller / layout).
  darkMode: "class",
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
          // Calm professional teal — restful on the eyes, fitting for audit /
          // finance, with white-on-brand contrast kept legible.
          50: "#edf6f4",
          100: "#d3ebe6",
          500: "#199e91",
          600: "#0f766e",
          700: "#0c5d57",
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
