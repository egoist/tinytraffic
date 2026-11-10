import { createSignal } from "solid-js";

export type Theme = "light" | "dark" | "system";

const KEY = "tt-theme";

/** Inline script for <head>: applies the theme before first paint. */
export const themeScript = `(function(){try{var t=localStorage.getItem("${KEY}")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

function read(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    if (t === "light" || t === "dark") return t;
  } catch {}
  return "system";
}

const [theme, setThemeSignal] = createSignal<Theme>(typeof window === "undefined" ? "system" : read());

function apply(t: Theme) {
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

if (typeof window !== "undefined") {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (theme() === "system") apply("system");
  });
}

export { theme };

export function setTheme(t: Theme) {
  setThemeSignal(t);
  try {
    localStorage.setItem(KEY, t);
  } catch {}
  apply(t);
}
