import { countryName } from "./format";

export const dimLabels: Record<string, string> = {
  page: "Page",
  entry_page: "Entry page",
  exit_page: "Exit page",
  source: "Source",
  referrer: "Referrer",
  referrer_url: "Referrer link",
  utm_source: "UTM source",
  utm_medium: "UTM medium",
  utm_campaign: "UTM campaign",
  country: "Country",
  region: "Region",
  city: "City",
  browser: "Browser",
  os: "OS",
  device: "Device",
  event: "Goal",
};

/** Human label for a dimension value; empty values get a placeholder. */
export function valueLabel(dim: string, value: string) {
  if (dim === "country") return value ? countryName(value) : "Unknown";
  if (value) return value;
  switch (dim) {
    case "source":
    case "referrer":
    case "referrer_url":
      return "Direct / None";
    case "utm_source":
    case "utm_medium":
    case "utm_campaign":
      return "(none)";
    default:
      return "Unknown";
  }
}

export type Period = "today" | "yesterday" | "24h" | "7d" | "30d" | "90d" | "month" | "lastmonth" | "12mo" | "all" | "custom";

export const periods: { value: Period; label: string; shortcut?: string; group: number }[] = [
  { value: "today", label: "Today", shortcut: "D", group: 0 },
  { value: "yesterday", label: "Yesterday", shortcut: "E", group: 0 },
  { value: "24h", label: "Last 24 hours", group: 0 },
  { value: "7d", label: "Last 7 days", shortcut: "W", group: 1 },
  { value: "30d", label: "Last 30 days", shortcut: "T", group: 1 },
  { value: "90d", label: "Last 90 days", group: 1 },
  { value: "month", label: "This month", shortcut: "M", group: 2 },
  { value: "lastmonth", label: "Last month", group: 2 },
  { value: "12mo", label: "Last 12 months", shortcut: "Y", group: 3 },
  { value: "all", label: "All time", shortcut: "A", group: 3 },
];

export const periodValues = new Set<string>([...periods.map((p) => p.value), "custom"]);
