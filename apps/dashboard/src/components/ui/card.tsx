import { splitProps, type JSX } from "solid-js";
import { cn } from "~/lib/utils";

type DivProps = JSX.HTMLAttributes<HTMLDivElement>;

function make(base: string) {
  return (props: DivProps) => {
    const [local, rest] = splitProps(props, ["class"]);
    return <div class={cn(base, local.class)} {...rest} />;
  };
}

/**
 * A layer card: a gray frame holding a header strip (CardHeader) on top of a
 * raised white panel (CardContent). For a single white surface, use Surface.
 */
export const Card = make("flex flex-col rounded-xl bg-elevated text-card-foreground shadow-xs ring ring-border");
export const CardHeader = make("flex flex-col gap-1 px-5 py-3.5");
export const CardTitle = make("text-sm font-semibold leading-5 tracking-tight");
export const CardDescription = make("text-sm text-muted-foreground");
export const CardContent = make(
  "flex-1 rounded-xl bg-card p-5 ring ring-fill dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.04)]",
);
export const CardFooter = make("flex items-center px-5 py-3");

/** A single raised panel. */
export const Surface = make("rounded-xl bg-card text-card-foreground shadow-xs ring ring-line");
