/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Space Grotesk", "Inter", "system-ui", "sans-serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        canvas: "#DFF4FF",
        surface: "#FFFFFF",
        surface2: "#EFF9FF",
        surface3: "#E3F2FA",
        border: {
          DEFAULT: "rgba(0,43,76,.14)",
          subtle: "rgba(0,43,76,.08)",
        },
        ink: {
          DEFAULT: "#002B4C",
          muted: "#244A63",
          faint: "#496A7F",
        },
        accent: {
          DEFAULT: "#F59E71",
          soft: "#FFF0E8",
          hover: "#EA8959",
        },
        status: {
          backlog: "#6B7284",
          todo: "#7C8FB8",
          progress: "#E9A23B",
          review: "#8B7FE8",
          done: "#4CAF87",
        },
        risk: {
          high: "#E5484D",
          medium: "#E9A23B",
          low: "#6B7284",
        },
      },
      boxShadow: {
        card: "0 12px 28px -20px rgba(0,43,76,.35)",
        popover: "0 24px 70px rgba(0,43,76,.25)",
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
      },
    },
  },
  plugins: [],
};
