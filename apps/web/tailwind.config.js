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
        canvas: "#EAFBF1",
        surface: "#FFFFFF",
        surface2: "#F1FBF4",
        surface3: "#E4F5EA",
        border: {
          DEFAULT: "rgba(11,43,30,.14)",
          subtle: "rgba(11,43,30,.08)",
        },
        ink: {
          DEFAULT: "#0B2B1E",
          muted: "#2B4A3D",
          faint: "#4F6B5C",
        },
        accent: {
          DEFAULT: "#22A866",
          soft: "#E3F8EC",
          hover: "#1C8F57",
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
