/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "vy-accent-primary": "var(--vy-accent-primary)",
        "vy-accent-secondary": "var(--vy-accent-secondary)",
        "vy-accent-hover": "var(--vy-accent-hover)",
        "vy-accent-muted": "var(--vy-accent-muted)",
        "vy-surface-0": "var(--vy-surface-0)",
        "vy-surface-1": "var(--vy-surface-1)",
        "vy-surface-2": "var(--vy-surface-2)",
        "vy-surface-3": "var(--vy-surface-3)",
        "vy-surface-active": "var(--vy-surface-active)",
        "vy-bg-primary": "var(--vy-bg-primary)",
        "vy-bg-secondary": "var(--vy-bg-secondary)",
        "vy-bg-tertiary": "var(--vy-bg-tertiary)",
        "vy-bg-hover": "var(--vy-bg-hover)",
        "vy-bg-chat": "var(--vy-bg-chat)",
        "vy-bg-active": "var(--vy-bg-active)",
        "vy-msg-in": "var(--vy-msg-in)",
        "vy-msg-out": "var(--vy-msg-out)",
        "vy-text-primary": "var(--vy-text-primary)",
        "vy-text-secondary": "var(--vy-text-secondary)",
        "vy-text-muted": "var(--vy-text-muted)",
        "vy-border-primary": "var(--vy-border-primary)",
        "vy-border-subtle": "var(--vy-border-subtle)",
      },
      width: {
        "vy-sidebar": "var(--vy-sidebar-width)",
      },
      fontFamily: {
        sans: [
          "IBM Plex Sans JP",
          "IBM Plex Sans",
          "Segoe UI",
          "Hiragino Sans",
          "Noto Sans JP",
          "sans-serif",
        ],
      },
      borderRadius: {
        msg: "var(--vy-message-radius)",
      },
    },
  },
  plugins: [],
};
