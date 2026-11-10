import { createMemo } from "solid-js";

/** A tiny single-series trend line; no axes, purely a glance. */
export function Sparkline(props: { values: number[]; class?: string }) {
  const W = 120;
  const H = 32;
  const paths = createMemo(() => {
    const v = props.values;
    if (v.length < 2) return { line: "", area: "" };
    const max = Math.max(1, ...v);
    const pts = v.map((y, i) => [(i / (v.length - 1)) * W, H - 2 - (y / max) * (H - 4)] as const);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    return { line, area: `${line}L${W},${H}L0,${H}Z` };
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" class={props.class} aria-hidden="true">
      <path d={paths().area} fill="var(--chart-wash)" />
      <path
        d={paths().line}
        fill="none"
        stroke="var(--chart-1)"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  );
}
