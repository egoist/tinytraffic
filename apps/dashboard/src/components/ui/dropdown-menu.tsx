import * as DropdownMenuPrimitive from "@kobalte/core/dropdown-menu";
import { Check } from "lucide-solid";
import { Show, splitProps, type ComponentProps, type JSX } from "solid-js";
import { cn } from "~/lib/utils";

export const DropdownMenu = (props: ComponentProps<typeof DropdownMenuPrimitive.Root>) => (
  <DropdownMenuPrimitive.Root gutter={6} {...props} />
);
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export function DropdownMenuContent(props: ComponentProps<"div"> & { children: JSX.Element }) {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        class={cn(
          "z-50 min-w-44 origin-[var(--kb-menu-content-transform-origin)] overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg outline-none data-[expanded]:animate-in data-[expanded]:fade-in-0 data-[expanded]:zoom-in-95 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95",
          local.class,
        )}
        {...rest}
      >
        {local.children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem(
  props: ComponentProps<typeof DropdownMenuPrimitive.Item> & { class?: string; checked?: boolean; shortcut?: string },
) {
  const [local, rest] = splitProps(props, ["class", "children", "checked", "shortcut"]);
  return (
    <DropdownMenuPrimitive.Item
      class={cn(
        "relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        local.checked !== undefined && "pr-8",
        local.class,
      )}
      {...rest}
    >
      {local.children}
      <Show when={local.shortcut}>
        <kbd class="ml-auto pl-4 font-sans text-xs text-muted-foreground">{local.shortcut}</kbd>
      </Show>
      <Show when={local.checked}>
        <Check class="absolute right-2 !text-foreground" />
      </Show>
    </DropdownMenuPrimitive.Item>
  );
}

export function DropdownMenuLabel(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div class={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", local.class)} {...rest} />;
}

export function DropdownMenuSeparator(props: { class?: string }) {
  return <DropdownMenuPrimitive.Separator class={cn("-mx-1 my-1 h-px border-none bg-border", props.class)} />;
}
