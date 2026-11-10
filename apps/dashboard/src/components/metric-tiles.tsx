import { ArrowDownRight, ArrowUpRight } from "lucide-solid";
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import type { Metrics } from "~/lib/api";
import { change, formatDuration, formatFull, formatNumber, formatPercent } from "~/lib/format";
import { t } from "~/lib/i18n";
import { cn } from "~/lib/utils";
import { Skeleton } from "./ui/skeleton";

export type MetricKey = keyof Metrics;

/** Labels come from `t().metrics[key]`. */
export const metricDefs: {
  key: MetricKey;
  format: (n: number) => string;
  /** Whether an increase is good news. */
  upIsGood: boolean;
}[] = [
  { key: "visitors", format: formatNumber, upIsGood: true },
  { key: "visits", format: formatNumber, upIsGood: true },
  { key: "pageviews", format: formatNumber, upIsGood: true },
  { key: "views_per_visit", format: (n) => n.toFixed(2), upIsGood: true },
  { key: "bounce_rate", format: (n) => formatPercent(n), upIsGood: false },
  { key: "visit_duration", format: formatDuration, upIsGood: true },
];

export function MetricTiles(props: {
  current?: Metrics;
  previous?: Metrics | null;
  selected: MetricKey;
  onSelect: (k: MetricKey) => void;
}) {
  // One raised highlight that slides to the selected tile. The grid wraps at
  // smaller widths, so it follows the tile in both directions.
  let grid!: HTMLDivElement;
  const tiles: Partial<Record<MetricKey, HTMLButtonElement>> = {};
  const [box, setBox] = createSignal<{ x: number; y: number; w: number; h: number }>();
  const [animate, setAnimate] = createSignal(false);
  const measure = () => {
    const el = tiles[props.selected];
    if (el) setBox({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
  };
  onMount(() => {
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    onCleanup(() => ro.disconnect());
    // Place it without a transition first, then animate later moves.
    requestAnimationFrame(() => setAnimate(true));
  });
  createEffect(on(() => props.selected, measure, { defer: true }));

  return (
    <div ref={grid} class="relative grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-6">
      <Show when={box()}>
        {(b) => (
          <span
            aria-hidden="true"
            class={cn(
              "pointer-events-none absolute top-0 left-0 rounded-lg bg-card shadow-sm ring ring-line",
              animate() && "transition-[transform,width,height] duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]",
            )}
            style={{ transform: `translate(${b().x}px, ${b().y}px)`, width: `${b().w}px`, height: `${b().h}px` }}
          />
        )}
      </Show>
      <For each={metricDefs}>
        {(m) => {
          const value = () => props.current?.[m.key];
          const delta = () => (props.current ? change(props.current[m.key], props.previous?.[m.key]) : null);
          const selected = () => props.selected === m.key;
          return (
            <button
              ref={(el) => (tiles[m.key] = el)}
              type="button"
              onClick={() => props.onSelect(m.key)}
              aria-pressed={selected()}
              class={cn(
                "group relative cursor-pointer rounded-lg px-3.5 py-3 text-left outline-none transition-[background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring",
                !selected() && "hover:bg-accent",
              )}
            >
              <div class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span
                  class={cn("size-1.5 rounded-full transition-colors", selected() ? "bg-chart-1" : "bg-muted-foreground/40")}
                  aria-hidden="true"
                />
                {t().metrics[m.key]}
              </div>
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
            title={t().metrics.compared}
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
