import { X } from "lucide-solid";
import { For, Show } from "solid-js";
import { dimLabel, valueLabel } from "~/lib/dims";
import { t } from "~/lib/i18n";

export function parseFilter(f: string) {
  const i = f.indexOf(":");
  return { dim: f.slice(0, i), value: f.slice(i + 1) };
}

export function FilterBar(props: { filters: string[]; onRemove: (f: string) => void; onClear: () => void }) {
  return (
    <Show when={props.filters.length > 0}>
      <div class="flex flex-wrap items-center gap-2">
        <For each={props.filters}>
          {(f) => {
            const { dim, value } = parseFilter(f);
            return (
              <span class="inline-flex h-7 items-center gap-1.5 rounded-full bg-card pr-1 pl-3 text-xs shadow-xs ring ring-line">
                <span class="text-muted-foreground">{dimLabel(dim)}</span>
                <span class="text-muted-foreground">{t().filters.is}</span>
                <span class="max-w-56 truncate font-medium">{valueLabel(dim, value)}</span>
                <button
                  type="button"
                  class="ml-0.5 grid size-5 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={t().filters.remove(dimLabel(dim))}
                  onClick={() => props.onRemove(f)}
                >
                  <X class="size-3" />
                </button>
              </span>
            );
          }}
        </For>
        <Show when={props.filters.length > 1}>
          <button type="button" class="cursor-pointer text-xs text-muted-foreground hover:text-foreground" onClick={props.onClear}>
            {t().filters.clearAll}
          </button>
        </Show>
      </div>
    </Show>
  );
}
