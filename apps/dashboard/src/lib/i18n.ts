import { createSignal } from "solid-js";
import { en, type Messages } from "./locales/en";
import { zh } from "./locales/zh";

export type Locale = "en" | "zh";
/** "system" follows the browser's language. */
export type LocalePref = Locale | "system";

const KEY = "tt-lang";
const dictionaries: Record<Locale, Messages> = { en, zh };

/** BCP 47 tags for Intl, which also picks the script (Simplified Chinese). */
const intlTags: Record<Locale, string> = { en: "en", zh: "zh-CN" };

/** The first supported language in the browser's preference list. */
function detect(): Locale {
  if (typeof navigator === "undefined") return "en";
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of langs) {
    const base = l?.toLowerCase().split("-")[0];
    if (base === "zh" || base === "en") return base;
  }
  return "en";
}

function read(): LocalePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "en" || v === "zh") return v;
  } catch {}
  return "system";
}

const [localePref, setPrefSignal] = createSignal<LocalePref>(typeof window === "undefined" ? "system" : read());
const [systemLocale, setSystemLocale] = createSignal<Locale>(detect());

export { localePref };

export const locale = (): Locale => {
  const p = localePref();
  return p === "system" ? systemLocale() : p;
};

/** The locale as a tag for Intl formatters. */
export const intlLocale = () => intlTags[locale()];

/** The current language's messages. Reactive: read it inside JSX or effects. */
export const t = () => dictionaries[locale()];

function applyLang() {
  document.documentElement.lang = intlLocale();
}

if (typeof window !== "undefined") {
  applyLang();
  window.addEventListener("languagechange", () => {
    setSystemLocale(detect());
    applyLang();
  });
}

export function setLocale(p: LocalePref) {
  setPrefSignal(p);
  try {
    if (p === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {}
  applyLang();
}

/** Inline script for <head>: sets <html lang> before first paint. */
export const langScript = `(function(){try{var p=localStorage.getItem("${KEY}");var l=p==="en"||p==="zh"?p:null;if(!l){var ls=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];l="en";for(var i=0;i<ls.length;i++){var b=(ls[i]||"").toLowerCase().split("-")[0];if(b==="zh"||b==="en"){l=b;break}}}document.documentElement.lang=l==="zh"?"zh-CN":"en"}catch(e){}})()`;

/** An error's message in the current language, for errors the server sends in English. */
export function errorMessage(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return t().serverErrors[msg] ?? msg;
}
