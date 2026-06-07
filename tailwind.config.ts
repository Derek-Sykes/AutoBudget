import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        // Darkened from slate-500 (#64748b) so secondary text meets WCAG AA on
        // white, slate-50, and the brand-50/tinted backgrounds it appears on.
        muted: "#475569",
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
        },
        // 700-level shades so the accent text meets WCAG AA on their -50 tints.
        positive: "#047857",
        warn: "#b45309",
        danger: "#b91c1c",
      },
    },
  },
  plugins: [],
};

export default config;
