const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en");

export function formatNumber(n: number) {
  return n >= 10_000 ? compact.format(n) : full.format(Math.round(n));
}

export function formatFull(n: number) {
  return full.format(Math.round(n));
}

export function formatDuration(seconds: number) {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
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

let regionNames: Intl.DisplayNames | undefined;
export function countryName(code: string) {
  if (!code) return "";
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code) ?? code;
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
  if (interval === "hour") {
    const time = d.toLocaleTimeString("en", { hour: "numeric" });
    return long ? `${d.toLocaleDateString("en", { month: "short", day: "numeric" })}, ${time}` : time;
  }
  if (interval === "month") {
    return d.toLocaleDateString("en", { month: long ? "long" : "short", year: "numeric" });
  }
  return d.toLocaleDateString("en", long ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric" });
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

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
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}
