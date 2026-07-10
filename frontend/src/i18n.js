import nl from "./locales/nl";
import en from "./locales/en";

export const LOCALIZATION = { nl, en };
export const DEFAULT_LANGUAGE = "nl";
export const SUPPORTED_LANGUAGES = Object.keys(LOCALIZATION);

if (import.meta.env?.DEV) {
  const defaultKeys = Object.keys(LOCALIZATION[DEFAULT_LANGUAGE].text);
  for (const lang of SUPPORTED_LANGUAGES) {
    if (lang === DEFAULT_LANGUAGE) continue;
    const missing = defaultKeys.filter((key) => !(key in LOCALIZATION[lang].text));
    if (missing.length) console.warn(`[i18n] "${lang}" is missing translation keys: ${missing.join(", ")}`);
  }
}

export function getRuntimeLanguage() {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  const raw = String(window.__ENV__?.LANGUAGE || DEFAULT_LANGUAGE).toLowerCase();
  return SUPPORTED_LANGUAGES.includes(raw) ? raw : DEFAULT_LANGUAGE;
}
export function getRuntimeCurrencyLocale() {
  return LOCALIZATION[getRuntimeLanguage()]?.currencyLocale || LOCALIZATION[DEFAULT_LANGUAGE].currencyLocale;
}
export function getRuntimeDateLocale() {
  return LOCALIZATION[getRuntimeLanguage()]?.dateLocale || LOCALIZATION[DEFAULT_LANGUAGE].dateLocale;
}
export function t(lang, key, vars = {}) {
  const template = (LOCALIZATION[lang]?.text?.[key] || LOCALIZATION[DEFAULT_LANGUAGE].text[key] || key);
  return Object.entries(vars).reduce((s, [placeholder, value]) => s.replace(`{${placeholder}}`, value), template);
}

export const LANG = getRuntimeLanguage();
export const TXT = LOCALIZATION[LANG]?.text || LOCALIZATION[DEFAULT_LANGUAGE].text;

export function getRuntimeAppTitle() {
  if (typeof window === "undefined") return TXT.appTitle;
  const raw = window.__ENV__?.APP_TITLE?.trim();
  return raw || TXT.appTitle;
}
