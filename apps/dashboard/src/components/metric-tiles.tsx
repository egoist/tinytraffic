import { ArrowDownRight, ArrowUpRight } from "lucide-solid";
import { For, Show } from "solid-js";
import type { Metrics } from "~/lib/api";
import { change, formatDuration, formatFull, formatNumber, formatPercent } from "~/lib/format";
import { cn } from "~/lib/utils";
import { Skeleton } from "./ui/skeleton";

export type MetricKey = keyof Metrics;

export const metricDefs: {
  key: MetricKey;
  label: string;
  format: (n: number) => string;
  /** Whether an increase is good news. */
  upIsGood: boolean;
}[] = [
  { key: "visitors", label: "Unique visitors", format: formatNumber, upIsGood: true },
  { key: "visits", label: "Total visits", format: formatNumber, upIsGood: true },
  { key: "pageviews", label: "Pageviews", format: formatNumber, upIsGood: true },
  { key: "views_per_visit", label: "Views per visit", format: (n) => n.toFixed(2), upIsGood: true },
  { key: "bounce_rate", label: "Bounce rate", format: (n) => formatPercent(n), upIsGood: false },
  { key: "visit_duration", label: "Visit duration", format: formatDuration, upIsGood: true },
];

export function MetricTiles(props: {
  current?: Metrics;
  previous?: Metrics | null;
  selected: MetricKey;
  onSelect: (k: MetricKey) => void;
}) {
  return (
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
      <For each={metricDefs}>
        {(m) => {
          const value = () => props.current?.[m.key];
          const delta = () => (props.current ? change(props.current[m.key], props.previous?.[m.key]) : null);
          const selected = () => props.selected === m.key;
          return (
            <button
              type="button"
              onClick={() => props.onSelect(m.key)}
              aria-pressed={selected()}
              class={cn(
                "group relative cursor-pointer px-5 py-4 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/60",
                selected() && "bg-accent/40",
              )}
            >
              <div class="text-xs font-medium text-muted-foreground">{m.label}</div>
              <Show when={value() !== undefined} fallback={<Skeleton class="mt-2 h-7 w-20" />}>
                <div class="mt-1.5 flex items-baseline gap-2">
                  <span
                    class="text-2xl font-semibold tracking-tight tabular"
                    title={m.key === "visitors" || m.key === "visits" || m.key === "pageviews" ? formatFull(value()!) : undefined}
                  >
                    {m.format(value()!)}
                  </span>
                  <Delta value={delta()} upIsGood={m.upIsGood} />
                </div>
              </Show>
              <span
                class={cn(
                  "absolute inset-x-5 bottom-0 h-0.5 rounded-full bg-chart-1 transition-opacity",
                  selected() ? "opacity-100" : "opacity-0",
                )}
              />
            </button>
          );
        }}
      </For>
    </div>
  );
}

function Delta(props: { value: number | null; upIsGood: boolean }) {
  return (
    <Show when={props.value !== null && Number.isFinite(props.value)}>
      {(_) => {
        const v = () => props.value!;
        const rounded = () => Math.round(v());
        const good = () => (v() > 0) === props.upIsGood;
        return (
          <span
            class={cn(
              "inline-flex items-center text-xs font-medium tabular",
              rounded() === 0 ? "text-muted-foreground" : good() ? "text-positive" : "text-negative",
            )}
            title="Compared to the previous period"
          >
            <Show when={rounded() !== 0}>
              {v() > 0 ? <ArrowUpRight class="size-3.5" /> : <ArrowDownRight class="size-3.5" />}
            </Show>
            {Math.abs(rounded())}%
          </span>
        );
      }}
    </Show>
  );
}
