/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // 実体は styles/globals.css の :root に置き、ここからは変数を参照するだけにする。
        ink: "rgb(var(--ink) / <alpha-value>)",
        panel: "rgb(var(--panel) / <alpha-value>)",
        raise: "rgb(var(--raise) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        "line-soft": "rgb(var(--line-soft) / <alpha-value>)",
        text: "rgb(var(--text) / <alpha-value>)",
        dim: "rgb(var(--dim) / <alpha-value>)",
        faint: "rgb(var(--faint) / <alpha-value>)",
        shu: "rgb(var(--shu) / <alpha-value>)",
        "shu-lit": "rgb(var(--shu-lit) / <alpha-value>)",
        gold: "rgb(var(--gold) / <alpha-value>)",
      },
      fontFamily: {
        // Webフォントは配信せず、各OSに載っている書体で明朝／角ゴ／等幅を組み分ける。
        // 見出しは明朝、本文は角ゴ、数字とラテンの小ラベルは等幅、という対比が意匠の核。
        display: [
          "Hiragino Mincho ProN",
          "Hiragino Mincho Pro",
          "YuMincho",
          "Yu Mincho",
          "BIZ UDPMincho",
          "MS PMincho",
          "serif",
        ],
        sans: [
          "Hiragino Kaku Gothic ProN",
          "Hiragino Sans",
          "BIZ UDPGothic",
          "Yu Gothic Medium",
          "YuGothic",
          "Meiryo",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "SF Mono",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      borderRadius: {
        // 書類然とした佇まいにするため、既定の角丸をほぼ落とす。
        none: "0",
        sm: "1px",
        DEFAULT: "2px",
        md: "3px",
        lg: "4px",
        xl: "6px",
        full: "9999px",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        seal: {
          "0%": { opacity: "0", transform: "scale(0.82) rotate(-14deg)" },
          "100%": { opacity: "1", transform: "scale(1) rotate(-5deg)" },
        },
        draw: {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" },
        },
        "pulse-shu": {
          "0%, 100%": { opacity: "0.5" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        rise: "rise 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        seal: "seal 0.9s cubic-bezier(0.2, 0.9, 0.25, 1) both",
        draw: "draw 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "pulse-shu": "pulse-shu 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
