import { keepPreviousData, useQuery } from "@tanstack/solid-query";
import { Laptop, Maximize2, Monitor, Search, Smartphone, Tablet } from "lucide-solid";
import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js";
import { api, type BreakdownRow, type StatsParams } from "~/lib/api";
import { valueLabel } from "~/lib/dims";
import { flag, formatFull, formatNumber, formatPercent } from "~/lib/format";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";
import { TextTabs } from "./ui/tabs";

export type PanelTab = {
  dim: string;
  label: string;
  /** Header for the dimension column, e.g. "Page". */
  column: string;
  /** Header for the secondary count column. */
  countLabel?: string;
  /** Show conversion rate instead of share. */
  conversion?: boolean;
};

const ROWS = 9;

const deviceIcons: Record<string, (p: { class?: string }) => JSX.Element> = {
  Mobile: Smartphone,
  Tablet: Tablet,
  Laptop: Laptop,
  Desktop: Monitor,
};

function RowLabel(props: { dim: string; value: string }) {
  return (
    <span class="flex min-w-0 items-center gap-2">
      <Switch>
        <Match when={props.dim === "country"}>
          <span class="text-base leading-none">{flag(props.value)}</span>
        </Match>
        <Match when={props.dim === "device" && deviceIcons[props.value]}>
          {(Icon) => {
            const I = Icon();
            return <I class="size-3.5 shrink-0 text-muted-foreground" />;
          }}
        </Match>
      </Switch>
      <span class={cn("truncate", !props.value && "text-muted-foreground")}>{valueLabel(props.dim, props.value)}</span>
    </span>
  );
}

function Rows(props: {
  tab: PanelTab;
  rows: BreakdownRow[];
  total: number;
  onFilter: (dim: string, value: string) => void;
  showCount?: boolean;
}) {
  const max = createMemo(() => Math.max(1, ...props.rows.map((r) => r.visitors)));
  return (
    <ul class="flex flex-col gap-1">
      <For each={props.rows}>
        {(row) => {
          const share = () => (props.total ? (row.visitors / props.total) * 100 : 0);
          return (
            <li>
              <button
                type="button"
                onClick={() => props.onFilter(props.tab.dim, row.value)}
                class="group relative flex h-8 w-full cursor-pointer items-center gap-3 rounded-md text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                title={`Filter by ${valueLabel(props.tab.dim, row.value)}`}
              >
                <span
                  class="absolute inset-y-0 left-0 rounded-md bg-bar transition-[width] duration-300 group-hover:brightness-95 dark:group-hover:brightness-125"
                  style={{ width: `${(row.visitors / max()) * 100}%` }}
                />
                <span class="relative min-w-0 flex-1 px-2.5">
                  <RowLabel dim={props.tab.dim} value={row.value} />
                </span>
                <span class="relative flex shrink-0 items-center gap-3 pr-1 tabular">
                  <Show when={props.showCount && props.tab.countLabel}>
                    <span class="w-16 text-right text-muted-foreground">{formatNumber(row.count)}</span>
                  </Show>
                  <span class="w-12 text-right font-medium" title={formatFull(row.visitors)}>
                    {formatNumber(row.visitors)}
                  </span>
                  <span class="w-11 text-right text-xs text-muted-foreground">
                    {formatPercent(share(), share() < 10 && props.tab.conversion ? 1 : 0)}
                  </span>
                </span>
              </button>
            </li>
          );
        }}
      </For>
    </ul>
  );
}

export function BreakdownPanel(props: {
  title: string;
  tabs: PanelTab[];
  domain: string;
  params: StatsParams;
  onFilter: (dim: string, value: string) => void;
  class?: string;
  empty?: JSX.Element;
}) {
  const [tabDim, setTabDim] = createSignal(props.tabs[0].dim);
  const tab = () => props.tabs.find((t) => t.dim === tabDim()) ?? props.tabs[0];
  const query = useQuery(() => ({
    queryKey: ["breakdown", props.domain, tab().dim, props.params],
    queryFn: () => api.breakdown(props.domain, tab().dim, props.params, ROWS),
    placeholderData: keepPreviousData,
  }));
  const [open, setOpen] = createSignal(false);

  return (
    <Card class={cn("flex min-w-0 flex-col p-4 sm:p-5", props.class)}>
      <div class="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 class="text-[15px] font-semibold tracking-tight">{props.title}</h3>
        <Show when={props.tabs.length > 1}>
          <TextTabs value={tabDim()} onChange={setTabDim} items={props.tabs.map((t) => ({ value: t.dim, label: t.label }))} />
        </Show>
      </div>

      <div class="mb-1.5 flex items-center justify-between px-2.5 text-xs font-medium text-muted-foreground">
        <span>{tab().column}</span>
        <span class="flex gap-3 pr-1">
          <span class="w-12 text-right">Visitors</span>
          <span class="w-11 text-right">{tab().conversion ? "CR" : "Share"}</span>
        </span>
      </div>

      <div class={cn("flex-1 transition-opacity", props.tabs.length > 1 ? "min-h-[328px]" : "min-h-32", query.isPlaceholderData && "opacity-60")}>
        <Switch>
          <Match when={query.isPending}>
            <div class="flex flex-col gap-1">
              <For each={[80, 64, 52, 40, 30, 22]}>{(w) => <Skeleton class="h-8" style={{ width: `${w}%` }} />}</For>
            </div>
          </Match>
          <Match when={query.isError}>
            <p class="py-12 text-center text-sm text-muted-foreground">Couldn't load this panel.</p>
          </Match>
          <Match when={query.data && query.data.rows.length === 0}>
            <div class="py-12 text-center text-sm text-muted-foreground">{props.empty ?? "No data yet"}</div>
          </Match>
          <Match when={query.data}>
            {(data) => <Rows tab={tab()} rows={data().rows} total={data().total_visitors} onFilter={props.onFilter} />}
          </Match>
        </Switch>
      </div>

      <Show when={(query.data?.rows.length ?? 0) >= ROWS}>
        <div class="mt-2 flex justify-center">
          <Button variant="ghost" size="sm" class="text-muted-foreground" onClick={() => setOpen(true)}>
            <Maximize2 class="!size-3.5" /> Details
          </Button>
        </div>
      </Show>

      <Show when={open()}>
        <DetailsDialog
          open={open()}
          onOpenChange={setOpen}
          title={`${props.title} · ${tab().label}`}
          tab={tab()}
          domain={props.domain}
          params={props.params}
          onFilter={(d, v) => {
            setOpen(false);
            props.onFilter(d, v);
          }}
        />
      </Show>
    </Card>
  );
}

function DetailsDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  tab: PanelTab;
  domain: string;
  params: StatsParams;
  onFilter: (dim: string, value: string) => void;
}) {
  const [search, setSearch] = createSignal("");
  const query = useQuery(() => ({
    queryKey: ["breakdown", props.domain, props.tab.dim, props.params, 200],
    queryFn: () => api.breakdown(props.domain, props.tab.dim, props.params, 200),
  }));
  const rows = createMemo(() => {
    const s = search().toLowerCase();
    const all = query.data?.rows ?? [];
    return s ? all.filter((r) => valueLabel(props.tab.dim, r.value).toLowerCase().includes(s)) : all;
  });
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent class="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
        </DialogHeader>
        <div class="relative">
          <Search class="absolute top-2.5 left-3 size-4 text-muted-foreground" />
          <Input placeholder="Search" class="pl-9" value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
        </div>
        <div class="flex items-center justify-between px-2.5 text-xs font-medium text-muted-foreground">
          <span>{props.tab.column}</span>
          <span class="flex gap-3 pr-1">
            <Show when={props.tab.countLabel}>
              <span class="w-16 text-right">{props.tab.countLabel}</span>
            </Show>
            <span class="w-12 text-right">Visitors</span>
            <span class="w-11 text-right">{props.tab.conversion ? "CR" : "Share"}</span>
          </span>
        </div>
        <div class="-mx-1 max-h-[55vh] overflow-y-auto px-1">
          <Show when={!query.isPending} fallback={<Skeleton class="h-40" />}>
            <Rows tab={props.tab} rows={rows()} total={query.data?.total_visitors ?? 0} onFilter={props.onFilter} showCount />
            <Show when={rows().length === 0}>
              <p class="py-10 text-center text-sm text-muted-foreground">Nothing matches</p>
            </Show>
          </Show>
        </div>
      </DialogContent>
    </Dialog>
  );
}
