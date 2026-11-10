import { createUniqueId } from "solid-js";
import { cn } from "~/lib/utils";

export function LogoMark(props: { class?: string }) {
  const gloss = `logo-gloss-${createUniqueId()}`;
  return (
    <svg viewBox="0 0 24 24" class={cn("size-6 drop-shadow-[0_1px_1px_rgb(0_0_0/0.15)]", props.class)} aria-hidden="true">
      <defs>
        <linearGradient id={gloss} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="0.28" />
          <stop offset="1" stop-color="#fff" stop-opacity="0" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="7" class="fill-foreground" />
      <rect width="24" height="24" rx="7" fill={`url(#${gloss})`} />
      <rect x="0.5" y="0.5" width="23" height="23" rx="6.5" fill="none" stroke="#fff" stroke-opacity="0.18" />
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
