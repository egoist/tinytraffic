import type { JSX } from "solid-js";
import { cn } from "~/lib/utils";

export function Skeleton(props: { class?: string; style?: JSX.CSSProperties }) {
  return <div class={cn("animate-pulse rounded-md bg-recessed", props.class)} style={props.style} />;
}
