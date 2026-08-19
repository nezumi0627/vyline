import { useStore } from "@/lib/store";
import { THEME_PRESETS } from "@/lib/theme-presets";
import { useEffect, useLayoutEffect, useRef } from "react";

const LIGHT_THEME_ID = "soft-day";
const DEFAULT_DARK_THEME_ID = "telegram-night";

/** Applies the active VyTheme + display settings to the document root. */
export function ThemeApplier() {
	const theme = useStore((s) => s.theme);
	const fontScale = useStore((s) => s.settings.fontScale);
	const compact = useStore((s) => s.settings.compactDensity);
	const syncWithSystem = useStore((s) => s.settings.themeSyncWithSystem);
	const setTheme = useStore((s) => s.setTheme);
	const lastDarkThemeId = useRef(
		theme.id === LIGHT_THEME_ID ? DEFAULT_DARK_THEME_ID : theme.id,
	);
	const currentThemeId = useRef(theme.id);

	useEffect(() => {
		currentThemeId.current = theme.id;
		if (theme.id !== LIGHT_THEME_ID) lastDarkThemeId.current = theme.id;
	}, [theme.id]);

	// OS の prefers-color-scheme を監視し、ON の間はダーク/ライトの切替えを自動適用（Knot/LEINs
	// の「ダークモードをシステムと同期」相当）。theme.id を依存配列に入れるとテーマ変更ごとに
	// listener を張り直すことになるため、ref 経由で最新値を参照する（exhaustive-deps を正当に満たす）。
	useEffect(() => {
		if (!syncWithSystem || typeof window === "undefined" || !window.matchMedia)
			return;
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = (isDark: boolean) => {
			const targetId = isDark
				? (lastDarkThemeId.current ?? DEFAULT_DARK_THEME_ID)
				: LIGHT_THEME_ID;
			const preset = THEME_PRESETS.find((t) => t.id === targetId);
			if (preset && preset.id !== currentThemeId.current) setTheme(preset);
		};
		apply(mq.matches);
		const listener = (e: MediaQueryListEvent) => apply(e.matches);
		mq.addEventListener("change", listener);
		return () => mq.removeEventListener("change", listener);
	}, [syncWithSystem, setTheme]);

	useLayoutEffect(() => {
		const r = document.documentElement;
		const map: Record<string, string> = {
			"--vy-bg": theme.bg,
			"--vy-surface": theme.surface,
			"--vy-surface-2": theme.surface2,
			"--vy-sidebar": theme.sidebar,
			"--vy-text": theme.text,
			"--vy-text-dim": theme.textDim,
			"--vy-accent": theme.accent,
			"--vy-accent-contrast": theme.accentContrast,
			"--vy-border": theme.border,
			"--vy-msg-in": theme.msgIn,
			"--vy-msg-out": theme.msgOut,
			"--vy-msg-in-text": theme.msgInText,
			"--vy-msg-out-text": theme.msgOutText,
			"--vy-radius": `${theme.radius}rem`,
			"--vy-message-radius": `${theme.radius}rem`,
			"--vy-chat-bg": theme.chatBg,
			"--vy-chat-pattern": String(theme.pattern),
		};
		for (const [k, v] of Object.entries(map)) r.style.setProperty(k, v);
		if (theme.chatImage) {
			r.style.setProperty("--vy-chat-image", `url(${theme.chatImage})`);
		} else {
			r.style.removeProperty("--vy-chat-image");
		}
		const meta = document.querySelector('meta[name="theme-color"]');
		if (meta) meta.setAttribute("content", theme.bg);
	}, [theme]);

	useLayoutEffect(() => {
		// 文字サイズのみ（ルート rem をいじるとレイアウト全体が拡大してしまう）
		const scale = Number.isFinite(fontScale) ? fontScale : 1;
		document.documentElement.style.setProperty(
			"--vy-font-scale",
			String(scale),
		);
		document.documentElement.style.fontSize = "";
		document.documentElement.dataset.fontScale = String(scale);
	}, [fontScale]);

	useLayoutEffect(() => {
		document.documentElement.classList.toggle("vy-compact", compact);
		document.documentElement.dataset.compact = compact ? "1" : "0";
	}, [compact]);

	return null;
}
