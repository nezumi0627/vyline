import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export const UI_LANGUAGES = [
  { code: "system", name: "システム設定" },
  { code: "ja", name: "日本語" },
  { code: "en", name: "English" },
  { code: "zh-TW", name: "繁體中文（台灣）" },
  { code: "zh-CN", name: "简体中文" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "ko", name: "한국어" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "th", name: "ไทย" },
] as const;

export type UiLanguage = (typeof UI_LANGUAGES)[number]["code"];
export type ResolvedUiLanguage = Exclude<UiLanguage, "system">;

const supportedLanguages: ResolvedUiLanguage[] = [
  "ja", "en", "zh-TW", "zh-CN", "id", "ko", "es", "fr", "de", "pt-BR", "vi", "th",
];
const localeLoaders = import.meta.glob<Record<string, string>>("./locales/*.json", {
  import: "default",
});

function resolveSystemLanguage(): ResolvedUiLanguage {
  const candidates = typeof navigator === "undefined" ? [] : navigator.languages;
  for (const candidate of candidates) {
    let normalized: string | undefined;
    try {
      normalized = Intl.getCanonicalLocales(candidate)[0];
    } catch {
      continue;
    }
    if (!normalized) continue;
    if (normalized.toLowerCase().startsWith("zh-tw") || normalized.toLowerCase().startsWith("zh-hant")) return "zh-TW";
    if (normalized.toLowerCase().startsWith("zh")) return "zh-CN";
    const exact = supportedLanguages.find((language) => language.toLowerCase() === normalized.toLowerCase());
    if (exact) return exact;
    const base = normalized.split("-")[0]?.toLowerCase();
    const match = supportedLanguages.find((language) => language.toLowerCase() === base);
    if (match) return match;
  }
  return "ja";
}

export function getResolvedLanguage(language: UiLanguage): ResolvedUiLanguage {
  return language === "system" ? resolveSystemLanguage() : language;
}

export async function initializeI18n(language: UiLanguage): Promise<void> {
  const resolved = getResolvedLanguage(language);
  if (!i18n.isInitialized) {
    i18n.use(initReactI18next);
    await i18n.init({
      lng: resolved,
      fallbackLng: "ja",
      supportedLngs: supportedLanguages,
      load: "currentOnly",
      resources: { ja: { translation: {} } },
      interpolation: { escapeValue: false },
      returnEmptyString: false,
    });
  }
  const loadCatalog = localeLoaders[`./locales/${resolved}.json`];
  if (loadCatalog && !i18n.hasResourceBundle(resolved, "translation")) {
    i18n.addResourceBundle(resolved, "translation", await loadCatalog(), true, true);
  }
  if (i18n.language !== resolved) {
    await i18n.changeLanguage(resolved);
  }
  document.documentElement.lang = resolved;
}

export async function changeUiLanguage(language: UiLanguage): Promise<void> {
  await initializeI18n(language);
}

export function getIntlLocale(): ResolvedUiLanguage {
  return (i18n.resolvedLanguage as ResolvedUiLanguage | undefined) ?? "ja";
}

/** Japanese source text is also the stable fallback key for untranslated UI. */
export function tr(source: string, values?: Record<string, unknown>): string {
  return i18n.t(source, { defaultValue: source, ...values });
}

export { i18n };
