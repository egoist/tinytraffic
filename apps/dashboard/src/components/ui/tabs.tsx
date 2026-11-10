import * as TabsPrimitive from "@kobalte/core/tabs";
import { For } from "solid-js";
import { cn } from "~/lib/utils";

/** Compact text tabs used in panel headers. */
export function TextTabs<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string }[];
  class?: string;
}) {
  return (
    <TabsPrimitive.Root value={props.value} onChange={(v) => props.onChange(v as T)} class={props.class}>
      <TabsPrimitive.List class="relative flex items-center gap-3">
        <For each={props.items}>
          {(item) => (
            <TabsPrimitive.Trigger
              value={item.value}
              class={cn(
                "cursor-pointer py-1 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground data-[selected]:text-foreground",
              )}
            >
              {item.label}
            </TabsPrimitive.Trigger>
          )}
        </For>
        <TabsPrimitive.Indicator class="absolute -bottom-px h-0.5 rounded-full bg-foreground transition-all duration-200" />
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
