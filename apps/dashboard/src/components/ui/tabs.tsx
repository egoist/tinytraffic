import * as TabsPrimitive from "@kobalte/core/tabs";
import { For } from "solid-js";
import { cn } from "~/lib/utils";

/** Compact segmented tabs: a recessed track with a raised thumb on the selected tab. */
export function TextTabs<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string }[];
  class?: string;
}) {
  return (
    <TabsPrimitive.Root value={props.value} onChange={(v) => props.onChange(v as T)} class={props.class}>
      <TabsPrimitive.List class="relative flex h-7 items-stretch rounded-lg bg-recessed p-0.5 shadow-[inset_0_1px_2px_0_rgb(0_0_0/0.05)] ring ring-border">
        <For each={props.items}>
          {(item) => (
            <TabsPrimitive.Trigger
              value={item.value}
              class={cn(
                "relative z-10 cursor-pointer rounded-md px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[selected]:text-foreground",
              )}
            >
              {item.label}
            </TabsPrimitive.Trigger>
          )}
        </For>
        <TabsPrimitive.Indicator class="absolute inset-y-0.5 left-0 rounded-md bg-card shadow-xs ring ring-line transition-all duration-200" />
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
