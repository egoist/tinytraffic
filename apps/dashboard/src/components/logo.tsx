import { cn } from "~/lib/utils";

export function LogoMark(props: { class?: string }) {
  return (
    <svg viewBox="0 0 24 24" class={cn("size-6", props.class)} aria-hidden="true">
      <rect width="24" height="24" rx="7" class="fill-foreground" />
      <path
        d="M6 15.5 9.5 11l3 3L18 7.5"
        fill="none"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="stroke-background"
      />
    </svg>
  );
}

export function Logo(props: { class?: string }) {
  return (
    <span class={cn("inline-flex items-center gap-2 font-semibold tracking-tight", props.class)}>
      <LogoMark />
      tinytraffic
    </span>
  );
}
