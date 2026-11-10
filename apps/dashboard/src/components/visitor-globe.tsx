import { keepPreviousData, useQuery } from "@tanstack/solid-query";
import createGlobe, { type Globe } from "cobe";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { api, type LocationPoint, type StatsParams } from "~/lib/api";
import { countryName, flag, formatNumber } from "~/lib/format";
import { ready } from "~/lib/query";
import { cn } from "~/lib/utils";

const TOP = 7;

/** Rotation that puts a location in the middle of the globe (cobe's convention). */
function anglesFor(lat: number, lon: number): [phi: number, theta: number] {
  return [Math.PI - ((lon * Math.PI) / 180 - Math.PI / 2), (lat * Math.PI) / 180];
}

function cssColor(name: string): [number, number, number] {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0.16, 0.47, 0.84];
}

function themeColors() {
  const dark = document.documentElement.classList.contains("dark");
  // Land is a quiet dot pattern close to the card surface; markers carry the
  // one data color.
  return dark
    ? {
        dark: 1,
        baseColor: [0.3, 0.3, 0.3] as [number, number, number],
        glowColor: [0.1, 0.1, 0.1] as [number, number, number],
        mapBrightness: 8,
        mapBaseBrightness: 0,
        diffuse: 2,
        markerColor: cssColor("--chart-1"),
      }
    : {
        dark: 0,
        baseColor: [1, 1, 1] as [number, number, number],
        glowColor: [0.95, 0.95, 0.94] as [number, number, number],
        mapBrightness: 3,
        mapBaseBrightness: 0.05,
        diffuse: 0.6,
        markerColor: cssColor("--chart-1"),
      };
}

const label = (p: LocationPoint) => p.city || countryName(p.country);

/**
 * Locations as a slowly turning globe. Each city is a marker sized by
 * visitors; hover a city in the list to turn the globe to it.
 */
export function VisitorGlobe(props: { domain: string; params: StatsParams; onFilter: (dim: string, value: string) => void }) {
  const query = useQuery(() => ({
    queryKey: ["locations", props.domain, props.params],
    queryFn: () => api.locations(props.domain, props.params),
    placeholderData: keepPreviousData,
  }));
  const points = () => ready(query)?.points ?? [];
  const top = createMemo(() => points().slice(0, TOP));
  const [active, setActive] = createSignal<number | null>(null);

  return (
    <div class="flex flex-col items-center gap-4 sm:flex-row sm:items-stretch">
      <div class="relative w-full max-w-[300px] shrink-0 sm:w-[52%]">
        <GlobeCanvas points={points()} active={active()} />
        <Show when={query.isSuccess && points().length === 0}>
          <p class="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            No locations in this period
          </p>
        </Show>
      </div>
      <ul class="flex w-full min-w-0 flex-col justify-center gap-0.5 self-center">
        <For each={top()}>
          {(p, i) => (
            <li>
              <button
                type="button"
                class={cn(
                  "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50",
                  active() === i() && "bg-accent",
                )}
                onPointerEnter={() => setActive(i())}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i())}
                onBlur={() => setActive(null)}
                onClick={() => (p.city ? props.onFilter("city", p.city) : props.onFilter("country", p.country))}
                title={`Filter by ${label(p)}`}
              >
                <span class="text-base leading-none">{flag(p.country)}</span>
                <span class="min-w-0 flex-1 truncate">{label(p)}</span>
                <span class="font-medium tabular">{formatNumber(p.visitors)}</span>
              </button>
            </li>
          )}
        </For>
        <Show when={points().length > TOP}>
          <li class="px-2 pt-1 text-xs text-muted-foreground">+ {formatNumber(points().length - TOP)} more cities</li>
        </Show>
      </ul>
    </div>
  );
}

function GlobeCanvas(props: { points: LocationPoint[]; active: number | null }) {
  let box!: HTMLDivElement;
  const [size, setSize] = createSignal(0);
  onMount(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      clearTimeout(timer);
      // The canvas size is fixed when cobe creates it, so the globe is
      // recreated on resize; debounce so dragging a window stays smooth.
      timer = setTimeout(() => setSize(w), size() ? 150 : 0);
    });
    ro.observe(box);
    onCleanup(() => {
      ro.disconnect();
      clearTimeout(timer);
    });
  });
  return (
    <div ref={box} class="aspect-square w-full">
      <Show when={size()} keyed>
        {(s) => <GlobeInstance size={s} points={props.points} active={props.active} />}
      </Show>
    </div>
  );
}

function GlobeInstance(props: { size: number; points: LocationPoint[]; active: number | null }) {
  let canvas!: HTMLCanvasElement;
  const [failed, setFailed] = createSignal(false);
  const [shown, setShown] = createSignal(false);
  const reduceMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const markers = createMemo(() => {
    const max = Math.max(1, ...props.points.map((p) => p.visitors));
    return props.points.map((p, i) => ({
      location: [p.lat, p.lon] as [number, number],
      size: 0.025 + 0.06 * Math.sqrt(p.visitors / max),
      id: `tt${i}`,
    }));
  });

  onMount(() => {
    let globe: Globe;
    let [phi, theta] = [0.6, 0.3];
    let target: [number, number] | null = null;
    let drag: { x: number; y: number; phi: number; theta: number } | null = null;
    let visible = true;
    let frame = 0;
    try {
      globe = createGlobe(canvas, {
        devicePixelRatio: Math.min(2, window.devicePixelRatio || 1),
        width: props.size,
        height: props.size,
        phi,
        theta,
        mapSamples: 16000,
        markers: markers(),
        markerElevation: 0.01,
        ...themeColors(),
      });
    } catch {
      setFailed(true);
      return;
    }

    // Once, when data arrives: turn to face the busiest location. Tilt is
    // softened so far-north or far-south cities don't show a pole.
    let aim: [number, number] | null = null;
    let aimed = false;

    const ease = (to: [number, number]) => {
      const d = Math.atan2(Math.sin(to[0] - phi), Math.cos(to[0] - phi)); // shortest way round
      phi += d * 0.08;
      theta += (to[1] - theta) * 0.08;
      return Math.abs(d) < 0.002 && Math.abs(to[1] - theta) < 0.002;
    };

    const loop = () => {
      frame = 0;
      if (!visible || document.hidden) return;
      if (target) {
        ease(target);
      } else if (aim && !drag) {
        if (ease(aim)) aim = null;
      } else if (!drag && !reduceMotion) {
        phi += 0.0025;
      }
      globe.update({ phi, theta });
      setShown(true);
      if (!reduceMotion || target || aim || drag) frame = requestAnimationFrame(loop);
    };
    (window as any).__ttGlobeDebug = () => ({ phi, theta, visible, frame, aim, target, drag }); // TEMP-DEBUG
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(loop);
    };
    kick();

    // Pause when scrolled away or the tab is hidden.
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) kick();
    });
    io.observe(canvas);
    const onVisibility = () => kick();
    document.addEventListener("visibilitychange", onVisibility);

    // Drag to rotate.
    const onDown = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, phi, theta };
      target = aim = null;
      canvas.setPointerCapture(e.pointerId);
      kick();
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      phi = drag.phi + (e.clientX - drag.x) / 120;
      theta = Math.max(-1, Math.min(1, drag.theta + (e.clientY - drag.y) / 240));
    };
    const onUp = () => (drag = null);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    createEffect(() => {
      globe.update({ markers: markers() });
      const first = props.points[0];
      if (first && !aimed) {
        aimed = true;
        const [p, t] = anglesFor(first.lat, first.lon);
        aim = [p, t * 0.6];
      }
      kick();
    });
    createEffect(() => {
      const p = props.active === null ? undefined : props.points[props.active];
      target = p ? anglesFor(p.lat, p.lon) : null;
      kick();
    });

    // Follow light/dark switches.
    const mo = new MutationObserver(() => {
      globe.update(themeColors());
      kick();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    onCleanup(() => {
      cancelAnimationFrame(frame);
      io.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      globe.destroy();
    });
  });

  const activePoint = () => (props.active === null ? undefined : props.points[props.active]);

  return (
    <div class="relative size-full">
      <Show
        when={!failed()}
        fallback={<p class="grid size-full place-items-center text-sm text-muted-foreground">Your browser can't show the globe.</p>}
      >
        <canvas
          ref={canvas}
          aria-label="Globe of visitor locations"
          role="img"
          class={cn("cursor-grab touch-none transition-opacity duration-700 active:cursor-grabbing", shown() ? "opacity-100" : "opacity-0")}
          style={{ width: `${props.size}px`, height: `${props.size}px` }}
        />
        {/* Label pinned to the hovered city's marker (CSS anchor positioning). */}
        <Show when={activePoint()}>
          {(p) => (
            <span
              class="pointer-events-none absolute z-10 rounded-md border bg-popover px-2 py-1 text-xs font-medium whitespace-nowrap text-popover-foreground shadow-sm transition-opacity"
              style={{
                "position-anchor": `--cobe-tt${props.active}`,
                bottom: "anchor(top)",
                left: "anchor(center)",
                translate: "-50% -8px",
                opacity: `var(--cobe-visible-tt${props.active}, 0)`,
              }}
            >
              {label(p())} · {formatNumber(p().visitors)}
            </span>
          )}
        </Show>
      </Show>
    </div>
  );
}
