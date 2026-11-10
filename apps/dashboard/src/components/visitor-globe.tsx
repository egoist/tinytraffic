import { keepPreviousData, useQuery } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Show } from "solid-js";
import { api, type LocationPoint, type StatsParams } from "~/lib/api";
import { countryName, flag, formatNumber } from "~/lib/format";
import { t } from "~/lib/i18n";
import { ready } from "~/lib/query";
import { cn } from "~/lib/utils";
import { Globe } from "./globe";

const TOP = 7;

const label = (p: LocationPoint) => p.city || countryName(p.country);

/**
 * Locations as a slowly turning globe. Each city is a marker sized by
 * visitors; hover a city in the list to turn the globe to it.
 */
export function VisitorGlobe(props: { domain: string; params: StatsParams; onFilter: (dim: string, value: string) => void }) {
  const query = useQuery(() => ({
    queryKey: ["locations", props.domain, props.params],
    queryFn: () => api.locations(props.domain, props.params),
    placeholderData: keepPreviousData,
  }));
  const points = () => ready(query)?.points ?? [];
  const top = createMemo(() => points().slice(0, TOP));
  const [active, setActive] = createSignal<number | null>(null);
  const activePoint = () => (active() === null ? undefined : points()[active()!]);
  // Once, when data arrives: turn to face the busiest location.
  const aim = createMemo<LocationPoint | null>((prev) => prev ?? points()[0] ?? null, null);
  const markers = createMemo(() => {
    const max = Math.max(1, ...points().map((p) => p.visitors));
    return points().map((p, i) => ({ lat: p.lat, lon: p.lon, size: 0.025 + 0.06 * Math.sqrt(p.visitors / max), id: `tt${i}` }));
  });

  return (
    <div class="flex flex-col items-center gap-4 sm:flex-row sm:items-stretch">
      <div class="relative w-full max-w-[300px] shrink-0 sm:w-[52%]">
        <Globe
          label={t().globe.locations}
          class="w-full"
          markers={markers()}
          focus={activePoint() ?? null}
          aim={aim() && { ...aim()!, key: 0 }}
        >
          {/* Label pinned to the hovered city's marker (CSS anchor positioning). */}
          <Show when={activePoint()}>
            {(p) => (
              <span
                class="pointer-events-none absolute z-10 rounded-md border bg-popover px-2 py-1 text-xs font-medium whitespace-nowrap text-popover-foreground shadow-sm transition-opacity"
                style={{
                  "position-anchor": `--cobe-tt${active()}`,
                  bottom: "anchor(top)",
                  left: "anchor(center)",
                  translate: "-50% -8px",
                  opacity: `var(--cobe-visible-tt${active()}, 0)`,
                }}
              >
                {label(p())} · {formatNumber(p().visitors)}
              </span>
            )}
          </Show>
        </Globe>
        <Show when={query.isSuccess && points().length === 0}>
          <p class="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            {t().globe.noLocations}
          </p>
        </Show>
      </div>
      <ul class="flex w-full min-w-0 flex-col justify-center gap-0.5 self-center">
        <For each={top()}>
          {(p, i) => (
            <li>
              <button
                type="button"
                class={cn(
                  "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50",
                  active() === i() && "bg-accent",
                )}
                onPointerEnter={() => setActive(i())}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i())}
                onBlur={() => setActive(null)}
                onClick={() => (p.city ? props.onFilter("city", p.city) : props.onFilter("country", p.country))}
                title={t().breakdown.filterBy(label(p))}
              >
                <span class="text-base leading-none">{flag(p.country)}</span>
                <span class="min-w-0 flex-1 truncate">{label(p)}</span>
                <span class="font-medium tabular">{formatNumber(p.visitors)}</span>
              </button>
            </li>
          )}
        </For>
        <Show when={points().length > TOP}>
          <li class="px-2 pt-1 text-xs text-muted-foreground">{t().globe.moreCities(formatNumber(points().length - TOP))}</li>
        </Show>
      </ul>
    </div>
  );
}
