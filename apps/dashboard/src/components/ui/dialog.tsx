import * as DialogPrimitive from "@kobalte/core/dialog";
import { X } from "lucide-solid";
import { splitProps, type ComponentProps, type JSX } from "solid-js";
import { t } from "~/lib/i18n";
import { cn } from "~/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent(props: ComponentProps<"div"> & { children: JSX.Element }) {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay class="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[expanded]:animate-in data-[expanded]:fade-in-0 data-[closed]:animate-out data-[closed]:fade-out-0" />
      <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[12vh]">
        <DialogPrimitive.Content
          class={cn(
            "relative grid w-full max-w-md gap-5 rounded-2xl bg-popover p-6 text-popover-foreground shadow-[0_24px_48px_-12px_rgb(0_0_0/0.25)] ring ring-line outline-none data-[expanded]:animate-in data-[expanded]:fade-in-0 data-[expanded]:zoom-in-[0.98] data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-[0.98]",
            local.class,
          )}
          {...rest}
        >
          {local.children}
          <DialogPrimitive.CloseButton class="absolute top-4 right-4 grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <X class="size-4" />
            <span class="sr-only">{t().common.close}</span>
          </DialogPrimitive.CloseButton>
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div class={cn("flex flex-col gap-1.5 pr-6", local.class)} {...rest} />;
}

export function DialogFooter(props: ComponentProps<"div">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <div class={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", local.class)} {...rest} />;
}

export function DialogTitle(props: ComponentProps<"h2">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <DialogPrimitive.Title class={cn("text-lg font-semibold tracking-tight", local.class)} {...rest} />;
}

export function DialogDescription(props: ComponentProps<"p">) {
  const [local, rest] = splitProps(props, ["class"]);
  return <DialogPrimitive.Description class={cn("text-sm text-muted-foreground", local.class)} {...rest} />;
}
