import { keepPreviousData, useQuery } from "@tanstack/solid-query";
import { ChevronRight, ExternalLink, Laptop, Maximize2, Monitor, Search, Smartphone, Tablet } from "lucide-solid";
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
import { ready } from "~/lib/query";
import { storage } from "~/lib/storage";

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
      <Show
        when={props.dim === "referrer_url" && props.value}
        fallback={<span class={cn("truncate", !props.value && "text-muted-foreground")}>{valueLabel(props.dim, props.value)}</span>}
      >
        {/* under a domain, the path is what matters */}
        <LinkLabel value={props.value} />
      </Show>
    </span>
  );
}

function LinkLabel(props: { value: string }) {
  const slash = () => props.value.indexOf("/");
  return (
    <Show
      when={slash() >= 0}
      fallback={
        <span class="truncate text-muted-foreground" title="The browser only sent the domain">
          {props.value} <span class="text-xs">· domain only</span>
        </span>
      }
    >
      <span class="truncate">
        <span class="text-muted-foreground">{props.value.slice(0, slash())}</span>
        {props.value.slice(slash())}
      </span>
    </Show>
  );
}

type Expand = {
  /** Rows that have children get a disclosure arrow. */
  canExpand: (row: BreakdownRow) => boolean;
  children: (row: BreakdownRow) => JSX.Element;
};

function Rows(props: {
  tab: PanelTab;
  rows: BreakdownRow[];
  total: number;
  onFilter: (dim: string, value: string) => void;
  showCount?: boolean;
  expand?: Expand;
}) {
  const max = createMemo(() => Math.max(1, ...props.rows.map((r) => r.visitors)));
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const toggle = (v: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });
  return (
    <ul class="flex flex-col gap-1">
      <For each={props.rows}>
        {(row) => {
          const share = () => (props.total ? (row.visitors / props.total) * 100 : 0);
          const open = () => expanded().has(row.value);
          return (
            <li>
              <div class="flex items-center gap-1">
                <Show when={props.expand}>
                  {(ex) => (
                    <Show when={ex().canExpand(row)} fallback={<span class="w-6 shrink-0" />}>
                      <button
                        type="button"
                        onClick={() => toggle(row.value)}
                        aria-expanded={open()}
                        aria-label={`${open() ? "Hide" : "Show"} links from ${row.value}`}
                        class="grid size-6 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <ChevronRight class={cn("size-4 transition-transform", open() && "rotate-90")} />
                      </button>
                    </Show>
                  )}
                </Show>
                <button
                  type="button"
                  onClick={() => props.onFilter(props.tab.dim, row.value)}
                  class="group relative flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-md text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
                {/* Trailing slot keeps number columns aligned between domain and link rows. */}
                <Show
                  when={props.tab.dim === "referrer_url" && row.value.includes("/")}
                  fallback={<Show when={props.expand || props.tab.dim === "referrer_url"}>{<span class="w-6 shrink-0" />}</Show>}
                >
                  <a
                    href={`https://${row.value}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    aria-label={`Open ${row.value}`}
                    title="Open link"
                  >
                    <ExternalLink class="size-3.5" />
                  </a>
                </Show>
              </div>
              <Show when={props.expand && open()}>
                <div class="mt-1 mb-2 ml-7 border-l pl-2">{props.expand!.children(row)}</div>
              </Show>
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
  /** Small print at the bottom of the card, e.g. data attribution. */
  footer?: JSX.Element;
}) {
  // Each card remembers its last selected tab in this browser.
  const storageKey = `tt-tab:${props.title}`;
  const saved = storage.get(storageKey);
  const [tabDim, setTabDimSignal] = createSignal(props.tabs.some((t) => t.dim === saved) ? saved! : props.tabs[0].dim);
  const setTabDim = (dim: string) => {
    setTabDimSignal(dim);
    storage.set(storageKey, dim);
  };
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

      <div
        class={cn(
          "flex-1 transition-opacity",
          props.tabs.length > 1 ? "min-h-[328px]" : "min-h-32",
          query.isPlaceholderData && "opacity-60",
        )}
      >
        <Switch>
          <Match when={query.isPending}>
            <div class="flex flex-col gap-1">
              <For each={[80, 64, 52, 40, 30, 22]}>{(w) => <Skeleton class="h-8" style={{ width: `${w}%` }} />}</For>
            </div>
          </Match>
          <Match when={query.isError}>
            <p class="py-12 text-center text-sm text-muted-foreground">Couldn't load this panel.</p>
          </Match>
          <Match when={ready(query)?.rows.length === 0}>
            <div class="py-12 text-center text-sm text-muted-foreground">{props.empty ?? "No data yet"}</div>
          </Match>
          <Match when={ready(query)}>
            {(data) => <Rows tab={tab()} rows={data().rows} total={data().total_visitors} onFilter={props.onFilter} />}
          </Match>
        </Switch>
      </div>

      <Show when={(ready(query)?.rows.length ?? 0) >= ROWS || ready(query)?.rows.some((r) => (r.links ?? 0) > 0)}>
        <div class="mt-2 flex justify-center">
          <Button variant="ghost" size="sm" class="text-muted-foreground" onClick={() => setOpen(true)}>
            <Maximize2 class="!size-3.5" /> Details
          </Button>
        </div>
      </Show>

      <Show when={props.footer}>
        <div class="mt-3 text-right text-[11px] text-muted-foreground">{props.footer}</div>
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
    const all = ready(query)?.rows ?? [];
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
        <div class={cn("flex items-center justify-between px-2.5 text-xs font-medium text-muted-foreground", props.tab.dim === "referrer" && "pl-9")}>
          <span>{props.tab.column}</span>
          <span class={cn("flex gap-3", props.tab.dim === "referrer" ? "pr-8" : "pr-1")}>
            <Show when={props.tab.countLabel}>
              <span class="w-16 text-right">{props.tab.countLabel}</span>
            </Show>
            <span class="w-12 text-right">Visitors</span>
            <span class="w-11 text-right">{props.tab.conversion ? "CR" : "Share"}</span>
          </span>
        </div>
        <div class="-mx-1 max-h-[55vh] overflow-y-auto px-1">
          <Show when={!query.isPending} fallback={<Skeleton class="h-40" />}>
            <Rows
              tab={props.tab}
              rows={rows()}
              total={ready(query)?.total_visitors ?? 0}
              onFilter={props.onFilter}
              showCount
              expand={
                props.tab.dim === "referrer"
                  ? {
                      canExpand: (r) => (r.links ?? 0) > 0,
                      children: (r) => (
                        <ReferrerLinks
                          site={props.domain}
                          referrer={r.value}
                          params={props.params}
                          total={ready(query)?.total_visitors ?? 0}
                          onFilter={props.onFilter}
                        />
                      ),
                    }
                  : undefined
              }
            />
            <Show when={rows().length === 0}>
              <p class="py-10 text-center text-sm text-muted-foreground">Nothing matches</p>
            </Show>
          </Show>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const linkTab: PanelTab = { dim: "referrer_url", label: "Links", column: "Link", countLabel: "Pageviews" };

/** The individual links under one referrer domain. */
function ReferrerLinks(props: {
  site: string;
  referrer: string;
  params: StatsParams;
  total: number;
  onFilter: (dim: string, value: string) => void;
}) {
  const params = () => ({
    ...props.params,
    f: [...(props.params.f ?? []).filter((f) => !f.startsWith("referrer:")), `referrer:${props.referrer}`],
  });
  const query = useQuery(() => ({
    queryKey: ["breakdown", props.site, "referrer_url", params(), 100],
    queryFn: () => api.breakdown(props.site, "referrer_url", params(), 100),
  }));
  return (
    <Show when={ready(query)} fallback={<Skeleton class="h-8" />}>
      {(data) => <Rows tab={linkTab} rows={data().rows} total={props.total} onFilter={props.onFilter} showCount />}
    </Show>
  );
}
