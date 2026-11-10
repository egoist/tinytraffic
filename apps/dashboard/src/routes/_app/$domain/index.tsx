import { keepPreviousData, useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/solid-router";
import { createMemo, Show } from "solid-js";
import { BreakdownPanel } from "~/components/breakdown-panel";
import { FilterBar, parseFilter } from "~/components/filter-bar";
import { metricDefs, MetricTiles, type MetricKey } from "~/components/metric-tiles";
import { PeriodPicker, type PeriodValue } from "~/components/period-picker";
import { Realtime } from "~/components/realtime";
import { TrafficChart } from "~/components/traffic-chart";
import { Card } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { api, type StatsParams } from "~/lib/api";
import { periodValues, type Period } from "~/lib/dims";
import { ready } from "~/lib/query";

type DashboardSearch = {
  period?: Period;
  from?: string;
  to?: string;
  f?: string[];
  metric?: MetricKey;
};

const metricKeys = new Set<string>(metricDefs.map((m) => m.key));
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const Route = createFileRoute("/_app/$domain/")({
  validateSearch: (s: Record<string, unknown>): DashboardSearch => {
    const period = periodValues.has(s.period as string) ? (s.period as Period) : undefined;
    const custom = period === "custom" && isDate(s.from) && isDate(s.to);
    return {
      period: period === "custom" && !custom ? undefined : period,
      from: custom ? (s.from as string) : undefined,
      to: custom ? (s.to as string) : undefined,
      f: Array.isArray(s.f) ? s.f.filter((x): x is string => typeof x === "string" && x.includes(":")) : undefined,
      metric: metricKeys.has(s.metric as string) ? (s.metric as MetricKey) : undefined,
    };
  },
  component: Dashboard,
});

function Dashboard() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const domain = () => params().domain;

  const stats = createMemo<StatsParams>(() => ({
    period: search().period ?? "30d",
    from: search().from,
    to: search().to,
    f: search().f ?? [],
  }));
  const metric = () => search().metric ?? "visitors";
  const metricDef = () => metricDefs.find((m) => m.key === metric())!;

  const aggregate = useQuery(() => ({
    queryKey: ["aggregate", domain(), stats()],
    queryFn: () => api.aggregate(domain(), stats()),
    placeholderData: keepPreviousData,
  }));
  const series = useQuery(() => ({
    queryKey: ["timeseries", domain(), stats()],
    queryFn: () => api.timeseries(domain(), stats()),
    placeholderData: keepPreviousData,
  }));

  const setPeriod = (v: PeriodValue) =>
    navigate({ search: (prev) => ({ ...prev, period: v.period === "30d" ? undefined : v.period, from: v.from, to: v.to }) });

  const addFilter = (dim: string, value: string) =>
    navigate({
      search: (prev) => ({
        ...prev,
        f: [...(prev.f ?? []).filter((f) => parseFilter(f).dim !== dim), `${dim}:${value}`],
      }),
    });
  const removeFilter = (f: string) =>
    navigate({ search: (prev) => ({ ...prev, f: (prev.f ?? []).filter((x) => x !== f) }) });

  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <Realtime domain={domain()} />
        <PeriodPicker value={{ period: stats().period as Period, from: stats().from, to: stats().to }} onChange={setPeriod} />
      </div>

      <FilterBar
        filters={stats().f ?? []}
        onRemove={removeFilter}
        onClear={() => navigate({ search: (prev) => ({ ...prev, f: undefined }) })}
      />

      <Show when={aggregate.error?.message === "site not found"}>
        <Card class="p-10 text-center">
          <p class="font-medium">This site doesn't exist.</p>
          <Link to="/" class="mt-2 inline-block text-sm text-muted-foreground underline underline-offset-4">
            Back to all sites
          </Link>
        </Card>
      </Show>

      <Card class="overflow-hidden">
        <div class="border-b">
          <MetricTiles
            current={ready(aggregate)?.current}
            previous={ready(aggregate)?.previous}
            selected={metric()}
            onSelect={(k) => navigate({ search: (prev) => ({ ...prev, metric: k === "visitors" ? undefined : k }) })}
          />
        </div>
        <div class={`px-3 pt-5 pb-2 transition-opacity sm:px-5 ${series.isPlaceholderData ? "opacity-60" : ""}`}>
          <Show when={ready(series)} fallback={<Skeleton class="h-[260px]" />}>
            {(data) => (
              <TrafficChart
                points={data().points}
                interval={data().query.interval}
                timezone={data().query.timezone}
                metric={{ label: metricDef().label, value: (p) => p[metric()], format: metricDef().format }}
              />
            )}
          </Show>
        </div>
      </Card>

      <div class="grid gap-4 md:grid-cols-2">
        <BreakdownPanel
          title="Sources"
          domain={domain()}
          params={stats()}
          onFilter={addFilter}
          tabs={[
            { dim: "source", label: "Sources", column: "Source", countLabel: "Pageviews" },
            { dim: "referrer", label: "Referrers", column: "Referrer", countLabel: "Pageviews" },
            { dim: "utm_campaign", label: "Campaigns", column: "Campaign", countLabel: "Pageviews" },
          ]}
        />
        <BreakdownPanel
          title="Pages"
          domain={domain()}
          params={stats()}
          onFilter={addFilter}
          tabs={[
            { dim: "page", label: "Top", column: "Page", countLabel: "Pageviews" },
            { dim: "entry_page", label: "Entry", column: "Entry page", countLabel: "Visits" },
            { dim: "exit_page", label: "Exit", column: "Exit page", countLabel: "Visits" },
          ]}
        />
        <BreakdownPanel
          title="Locations"
          domain={domain()}
          params={stats()}
          onFilter={addFilter}
          tabs={[
            { dim: "country", label: "Countries", column: "Country", countLabel: "Pageviews" },
            { dim: "region", label: "Regions", column: "Region", countLabel: "Pageviews" },
            { dim: "city", label: "Cities", column: "City", countLabel: "Pageviews" },
          ]}
        />
        <BreakdownPanel
          title="Devices"
          domain={domain()}
          params={stats()}
          onFilter={addFilter}
          tabs={[
            { dim: "browser", label: "Browsers", column: "Browser", countLabel: "Pageviews" },
            { dim: "os", label: "OS", column: "Operating system", countLabel: "Pageviews" },
            { dim: "device", label: "Size", column: "Screen size", countLabel: "Pageviews" },
          ]}
        />
        <BreakdownPanel
          title="Goals"
          class="md:col-span-2"
          domain={domain()}
          params={stats()}
          onFilter={addFilter}
          tabs={[{ dim: "event", label: "Events", column: "Custom event", countLabel: "Events", conversion: true }]}
          empty={
            <>
              No custom events yet.{" "}
              <Link to="/$domain/settings" params={{ domain: domain() }} class="underline underline-offset-4 hover:text-foreground">
                How to send one
              </Link>
            </>
          }
        />
      </div>
    </div>
  );
}
