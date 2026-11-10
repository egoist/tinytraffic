export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    credentials: "same-origin",
    headers: json !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? res.statusText, res.status);
  return data as T;
}

export type Site = {
  id: number;
  domain: string;
  timezone: string;
  created_at: string;
};

export type SiteWithStats = Site & { visitors_24h: number; sparkline: number[] };

export type Metrics = {
  visitors: number;
  visits: number;
  pageviews: number;
  views_per_visit: number;
  bounce_rate: number;
  visit_duration: number;
};

export type Filter = { dim: string; value: string };

export type QueryMeta = {
  period: string;
  from: string;
  to: string;
  interval: "hour" | "day" | "month";
  timezone: string;
  filters: Filter[];
};

export type Aggregate = { query: QueryMeta; current: Metrics; previous: Metrics | null };
export type Point = Metrics & { date: string };
export type Timeseries = { query: QueryMeta; points: Point[] };
export type BreakdownRow = {
  value: string;
  visitors: number;
  count: number;
  /** Referrer domains: number of distinct links (with a path) under it. */
  links?: number;
};
export type Breakdown = { rows: BreakdownRow[]; total_visitors: number };

export type ServerInfo = {
  geoip: { enabled: boolean; attribution: { text: string; url: string } };
};

export type APIKeyScope = "read" | "write";

export type APIKey = {
  id: number;
  name: string;
  prefix: string;
  scope: APIKeyScope;
  created_at: string;
  last_used_at: string | null;
};

export type StatsParams = { period: string; from?: string; to?: string; f?: string[] };

function qs(p: StatsParams, extra?: Record<string, string>) {
  const s = new URLSearchParams({ period: p.period, ...extra });
  if (p.period === "custom" && p.from && p.to) {
    s.set("from", p.from);
    s.set("to", p.to);
  }
  for (const f of p.f ?? []) s.append("f", f);
  return s.toString();
}

const site = (domain: string) => `/api/sites/${encodeURIComponent(domain)}`;

export const api = {
  auth: () => request<{ needs_setup: boolean; authenticated: boolean }>("/api/auth"),
  setup: (password: string) => request("/api/auth/setup", { method: "POST", json: { password } }),
  login: (password: string) => request("/api/auth/login", { method: "POST", json: { password } }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  changePassword: (password: string, new_password: string) =>
    request("/api/auth/password", { method: "POST", json: { password, new_password } }),

  sites: () => request<SiteWithStats[]>("/api/sites"),
  createSite: (domain: string, timezone: string) =>
    request<Site>("/api/sites", { method: "POST", json: { domain, timezone } }),
  updateSite: (domain: string, timezone: string) =>
    request<Site>(site(domain), { method: "PATCH", json: { timezone } }),
  deleteSite: (domain: string) => request(site(domain), { method: "DELETE" }),

  aggregate: (domain: string, p: StatsParams) => request<Aggregate>(`${site(domain)}/aggregate?${qs(p)}`),
  timeseries: (domain: string, p: StatsParams) => request<Timeseries>(`${site(domain)}/timeseries?${qs(p)}`),
  breakdown: (domain: string, dim: string, p: StatsParams, limit = 10) =>
    request<Breakdown>(`${site(domain)}/breakdown/${dim}?${qs(p, { limit: String(limit) })}`),
  realtime: (domain: string) => request<{ visitors: number }>(`${site(domain)}/realtime`),
  info: () => request<ServerInfo>("/api/info"),

  keys: () => request<APIKey[]>("/api/keys"),
  createKey: (name: string, scope: APIKeyScope) =>
    request<{ key: APIKey; token: string }>("/api/keys", { method: "POST", json: { name, scope } }),
  deleteKey: (id: number) => request(`/api/keys/${id}`, { method: "DELETE" }),
};
