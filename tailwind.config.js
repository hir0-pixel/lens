/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#FCAA26",
          50: "#FFF8EB",
          100: "#FEEDCB",
          200: "#FDDC98",
          300: "#FCC964",
          400: "#FCB842",
          500: "#FCAA26",
          600: "#E89106",
          700: "#C07406",
          800: "#9A5C08",
          900: "#7C4A0B",
        },
        surface: {
          0: "#0C0C0D",
          1: "#141415",
          2: "#1A1A1B",
          3: "#202022",
          4: "#262629",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "Geist Mono",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      borderRadius: {
        lg: "0.5rem",
      },
      boxShadow: {
        "glow-accent": "0 0 0 1px rgba(252, 170, 38, 0.5), 0 0 24px -6px rgba(252, 170, 38, 0.35)",
        "float-pop": "0 12px 40px -12px rgba(0, 0, 0, 0.6)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        pulseDot: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "fade-up": "fade-up 0.25s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
        "pulse-dot": "pulseDot 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
