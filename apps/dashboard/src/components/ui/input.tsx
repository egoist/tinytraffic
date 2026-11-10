import { splitProps, type JSX } from "solid-js";
import { cn } from "~/lib/utils";

export function Input(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <input
      class={cn(
        "flex h-9 w-full min-w-0 rounded-lg border-0 bg-card px-3 py-1 text-sm shadow-[inset_0_1px_1px_0_rgb(0_0_0/0.04)] ring ring-line transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-destructive",
        local.class,
      )}
      {...rest}
    />
  );
}

export function NativeSelect(props: JSX.SelectHTMLAttributes<HTMLSelectElement>) {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return (
    <select
      class={cn(
        "flex h-9 w-full appearance-none rounded-lg border-0 bg-card select-chevron pr-8 pl-3 text-sm shadow-xs ring ring-line outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring dark:[&>option]:bg-popover",
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </select>
  );
}

export function Label(props: JSX.LabelHTMLAttributes<HTMLLabelElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <label class={cn("text-sm font-medium leading-none select-none", local.class)} {...rest} />;
}
