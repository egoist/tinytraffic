import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Point } from "~/lib/api";
import { formatBucket } from "~/lib/format";

export type ChartMetric = {
  label: string;
  value: (p: Point) => number;
  format: (n: number) => string;
  /** Axis ticks for percentages/durations should not use fractional steps. */
  integer?: boolean;
};

const HEIGHT = 260;
const M = { top: 14, right: 12, bottom: 28, left: 46 };

/** Round a max up to a clean axis value and return evenly spaced ticks. */
function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0, 1, 2, 3, 4].map((v) => v / 4);
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return ticks;
}

/** Monotone cubic interpolation: smooth, but never overshoots the data. */
function monotonePath(pts: [number, number][]) {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    slope.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const t: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    t.push(slope[i - 1] * slope[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / slope[i - 1] + (dx[i] + 2 * dx[i - 1]) / slope[i]));
  }
  t.push(slope[n - 2]);
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += `C${(x0 + h).toFixed(1)},${(y0 + h * t[i]).toFixed(1)} ${(x1 - h).toFixed(1)},${(y1 - h * t[i + 1]).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

/** Current wall-clock time in a timezone, formatted like bucket labels. */
function nowIn(tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

/** Whether the bucket starting at `date` hasn't ended yet at `now`. */
function isOpenBucket(date: string, interval: "hour" | "day" | "month", now: string) {
  const len = interval === "hour" ? 13 : interval === "day" ? 10 : 7;
  return date.slice(0, len) === now.slice(0, len);
}

export function TrafficChart(props: {
  points: Point[];
  interval: "hour" | "day" | "month";
  timezone: string;
  metric: ChartMetric;
}) {
  let container!: HTMLDivElement;
  const [width, setWidth] = createSignal(800);
  const [hover, setHover] = createSignal<number | null>(null);

  onMount(() => {
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(container);
    onCleanup(() => ro.disconnect());
  });

  const geo = createMemo(() => {
    const pts = props.points;
    const w = width();
    const innerW = Math.max(1, w - M.left - M.right);
    const innerH = HEIGHT - M.top - M.bottom;
    // Buckets that haven't started yet are not drawn as zeros.
    const now = nowIn(props.timezone);
    const drawn = pts.filter((p) => p.date <= now).length;
    const values = pts.slice(0, drawn).map(props.metric.value);
    const ticks = niceTicks(Math.max(0, ...values));
    const top = ticks[ticks.length - 1] || 1;
    const x = (i: number) => M.left + (pts.length <= 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
    const y = (v: number) => M.top + innerH - (v / top) * innerH;
    const coords = values.map((v, i) => [x(i), y(v)] as [number, number]);
    // The bucket containing "now" is still filling up: draw its segment
    // dashed so a partial day doesn't read as a drop.
    const partial = drawn > 1 && drawn <= pts.length && (drawn < pts.length || isOpenBucket(pts[drawn - 1].date, props.interval, now));
    const solid = partial ? coords.slice(0, -1) : coords;
    const line = monotonePath(solid);
    const tail = partial ? coords.slice(-2) : [];
    const area = coords.length > 1 ? `${monotonePath(coords)}L${coords[coords.length - 1][0]},${y(0)}L${coords[0][0]},${y(0)}Z` : "";

    const maxLabels = Math.max(2, Math.floor(innerW / 76));
    const every = Math.max(1, Math.ceil(pts.length / maxLabels));
    const xLabels = pts.map((p, i) => ({ i, p })).filter(({ i }) => i % every === 0);
    const empty = values.every((v) => v === 0);
    return { x, y, ticks, line, tail, area, coords, xLabels, innerW, drawn, empty };
  });

  function onMove(e: PointerEvent) {
    const rect = container.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const n = props.points.length;
    if (n === 0) return;
    const i = n === 1 ? 0 : Math.round(((px - M.left) / geo().innerW) * (n - 1));
    setHover(Math.min(Math.max(i, 0), geo().drawn - 1));
  }

  const hovered = () => {
    const i = hover();
    return i === null || i < 0 ? null : { i, p: props.points[i], c: geo().coords[i] };
  };

  return (
    <div
      ref={container}
      class="relative w-full select-none"
      style={{ height: `${HEIGHT}px` }}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <svg width="100%" height={HEIGHT} role="img" aria-label={`${props.metric.label} over time`}>
        <For each={geo().ticks}>
          {(t) => (
            <g>
              <line x1={M.left} x2={width() - M.right} y1={geo().y(t)} y2={geo().y(t)} stroke="var(--chart-grid)" stroke-width="1" />
              <text x={M.left - 10} y={geo().y(t)} dy="0.32em" text-anchor="end" class="fill-muted-foreground text-[11px] tabular">
                {props.metric.format(t)}
              </text>
            </g>
          )}
        </For>
        <For each={geo().xLabels}>
          {({ i, p }) => (
            <text x={geo().x(i)} y={HEIGHT - 8} text-anchor="middle" class="fill-muted-foreground text-[11px]">
              {formatBucket(p.date, props.interval)}
            </text>
          )}
        </For>
        <path d={geo().area} fill="var(--chart-wash)" />
        <path d={geo().line} fill="none" stroke="var(--chart-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        <Show when={geo().tail.length === 2}>
          <line
            x1={geo().tail[0][0]}
            y1={geo().tail[0][1]}
            x2={geo().tail[1][0]}
            y2={geo().tail[1][1]}
            stroke="var(--chart-1)"
            stroke-width="2"
            stroke-dasharray="3 4"
            stroke-linecap="round"
          />
        </Show>
        <Show when={hovered()}>
          {(h) => (
            <g>
              <line x1={h().c[0]} x2={h().c[0]} y1={M.top} y2={HEIGHT - M.bottom} stroke="var(--muted-foreground)" stroke-opacity="0.35" stroke-width="1" />
              <circle cx={h().c[0]} cy={h().c[1]} r="4.5" fill="var(--chart-1)" stroke="var(--card)" stroke-width="2" />
            </g>
          )}
        </Show>
      </svg>

      <Show when={geo().empty}>
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center pb-6 text-sm text-muted-foreground">
          No data in this period
        </div>
      </Show>

      <Show when={hovered()}>
        {(h) => {
          const TIP = 200; // generous estimate of the tooltip's width
          const flip = () => h().c[0] + 12 + TIP > width();
          return (
            <div
              class="pointer-events-none absolute top-2 z-10 rounded-lg bg-popover px-3 py-2 whitespace-nowrap text-popover-foreground shadow-[0_8px_24px_-6px_rgb(0_0_0/0.18)] ring ring-line"
              style={flip() ? { right: `${width() - h().c[0] + 12}px` } : { left: `${h().c[0] + 12}px` }}
            >
              <div class="text-xs text-muted-foreground">{formatBucket(h().p.date, props.interval, true)}</div>
              <div class="mt-1 flex items-center gap-2 text-sm">
                <span class="size-2 rounded-full bg-chart-1" />
                <span class="font-semibold tabular">{props.metric.format(props.metric.value(h().p))}</span>
                <span class="text-muted-foreground">{props.metric.label.toLowerCase()}</span>
              </div>
            </div>
          );
        }}
      </Show>

      <table class="sr-only">
        <thead>
          <tr>
            <th>Date</th>
            <th>{props.metric.label}</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.points.slice(0, geo().drawn)}>
            {(p) => (
              <tr>
                <td>{formatBucket(p.date, props.interval, true)}</td>
                <td>{props.metric.format(props.metric.value(p))}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
