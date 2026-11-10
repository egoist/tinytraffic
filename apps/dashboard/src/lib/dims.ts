import { countryName } from "./format";
import { t } from "./i18n";

/** Human name of a dimension, e.g. "Entry page". */
export const dimLabel = (dim: string) => t().dims[dim] ?? dim;

/** Human label for a dimension value; empty values get a placeholder. */
export function valueLabel(dim: string, value: string) {
  const v = t().values;
  if (dim === "country") return value ? countryName(value) : v.unknown;
  if (dim === "device" && value) return t().devices[value] ?? value;
  if (value) return value;
  switch (dim) {
    case "source":
    case "referrer":
    case "referrer_url":
      return v.direct;
    case "utm_source":
    case "utm_medium":
    case "utm_campaign":
      return v.none;
    default:
      return v.unknown;
  }
}

export type Period = "today" | "yesterday" | "24h" | "7d" | "30d" | "90d" | "month" | "lastmonth" | "12mo" | "all" | "custom";

/** Labels come from `t().periods[value]`. */
export const periods: { value: Exclude<Period, "custom">; shortcut?: string; group: number }[] = [
  { value: "today", shortcut: "D", group: 0 },
  { value: "yesterday", shortcut: "E", group: 0 },
  { value: "24h", group: 0 },
  { value: "7d", shortcut: "W", group: 1 },
  { value: "30d", shortcut: "T", group: 1 },
  { value: "90d", group: 1 },
  { value: "month", shortcut: "M", group: 2 },
  { value: "lastmonth", group: 2 },
  { value: "12mo", shortcut: "Y", group: 3 },
  { value: "all", shortcut: "A", group: 3 },
];

export const periodValues = new Set<string>([...periods.map((p) => p.value), "custom"]);
