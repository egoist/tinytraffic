import { intlLocale, t } from "./i18n";

/** One formatter per locale and options, created on first use. */
function cached<T>(make: (locale: string) => T) {
  const byLocale = new Map<string, T>();
  return () => {
    const l = intlLocale();
    let f = byLocale.get(l);
    if (!f) byLocale.set(l, (f = make(l)));
    return f;
  };
}

const compact = cached((l) => new Intl.NumberFormat(l, { notation: "compact", maximumFractionDigits: 1 }));
const full = cached((l) => new Intl.NumberFormat(l));

export function formatNumber(n: number) {
  return n >= 10_000 ? compact().format(n) : full().format(Math.round(n));
}

export function formatFull(n: number) {
  return full().format(Math.round(n));
}

export function formatDuration(seconds: number) {
  const u = t().units;
  const s = Math.round(seconds);
  if (s < 60) return `${s}${u.s}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}${u.m}${u.sep}${s % 60}${u.s}`;
  return `${Math.floor(m / 60)}${u.h}${u.sep}${m % 60}${u.m}`;
}

export function formatPercent(n: number, digits = 0) {
  return `${n.toFixed(digits)}%`;
}

/** Percentage change, or null when there is nothing to compare against. */
export function change(current: number, previous: number | undefined) {
  if (previous === undefined) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

const regionNames = cached((l) => new Intl.DisplayNames([l], { type: "region" }));
export function countryName(code: string) {
  if (!code) return "";
  try {
    return regionNames().of(code) ?? code;
  } catch {
    return code;
  }
}

export function flag(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return "🌐";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

/** Parse the server's local "YYYY-MM-DDTHH:mm:ss" bucket labels. */
export function parseBucket(s: string) {
  const [d, t = "00:00:00"] = s.split("T");
  const [y, mo, day] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  return new Date(y, mo - 1, day, h, mi);
}

export function formatBucket(s: string, interval: "hour" | "day" | "month", long = false) {
  const d = parseBucket(s);
  const l = intlLocale();
  if (interval === "hour") {
    return long
      ? d.toLocaleString(l, { month: "short", day: "numeric", hour: "numeric" })
      : d.toLocaleTimeString(l, { hour: "numeric" });
  }
  if (interval === "month") {
    return d.toLocaleDateString(l, { month: long ? "long" : "short", year: "numeric" });
  }
  return d.toLocaleDateString(l, long ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric" });
}

const relative = cached((l) => new Intl.RelativeTimeFormat(l, { numeric: "auto" }));

/** "3 minutes ago", "yesterday", … */
export function timeAgo(iso: string) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative().format(Math.round(seconds / size), unit);
  }
  return t().units.justNow;
}
