import createGlobe, { type Globe as Cobe } from "cobe";
import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { cn } from "~/lib/utils";

export type LatLon = { lat: number; lon: number };

/**
 * A marker on the globe. Its `id` makes cobe expose the CSS anchor
 * `--cobe-{id}` and the variable `--cobe-visible-{id}` (unset while the
 * marker is behind the globe), which overlays position and fade with. Use
 * letters, digits, `-` and `_` only.
 */
export type GlobeMarker = LatLon & { id: string; size: number };

/** Styles for an overlay pinned to a marker, centered on it. */
export function pinnedTo(id: string): JSX.CSSProperties {
  return {
    "position-anchor": `--cobe-${id}`,
    left: "anchor(center)",
    top: "anchor(center)",
    translate: "-50% -50%",
    // cobe sets the variable to a non-number while the marker faces us, which
    // falls back to the property's initial value (shown, full size).
    opacity: `var(--cobe-visible-${id}, 0)`,
    scale: `var(--cobe-visible-${id}, 0)`,
  };
}

/** Whether overlays can be pinned to markers (CSS anchor positioning). */
export const canPin = typeof CSS !== "undefined" && CSS.supports("anchor-name", "--a");

/** Rotation that puts a location in the middle of the globe (cobe's convention). */
function anglesFor(p: LatLon): [phi: number, theta: number] {
  return [Math.PI - ((p.lon * Math.PI) / 180 - Math.PI / 2), (p.lat * Math.PI) / 180];
}

function cssColor(name: string): [number, number, number] {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [0.16, 0.47, 0.84];
}

function themeColors() {
  const dark = document.documentElement.classList.contains("dark");
  // Land is a quiet dot pattern close to the surface; markers carry the one
  // data color.
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

export type GlobeProps = {
  markers: GlobeMarker[];
  /** Turn to this place and hold it there. null lets the globe spin again. */
  focus?: LatLon | null;
  /** Turn to this place once, then keep spinning. A new `key` aims again. */
  aim?: (LatLon & { key: unknown }) | null;
  /** Default true. Always off when the viewer prefers reduced motion. */
  spinning?: boolean;
  mapSamples?: number;
  label: string;
  class?: string;
  onDragStart?: () => void;
  /** Overlays, positioned against the globe's box (see pinnedTo). */
  children?: JSX.Element;
};

/** A slowly turning, draggable globe of markers. Square; set its width. */
export function Globe(props: GlobeProps) {
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
    <div ref={box} class={cn("relative aspect-square", props.class)}>
      <Show when={size()} keyed>
        {(s) => <GlobeInstance {...props} size={s} />}
      </Show>
      {props.children}
    </div>
  );
}

function GlobeInstance(props: GlobeProps & { size: number }) {
  let canvas!: HTMLCanvasElement;
  const [failed, setFailed] = createSignal(false);
  const [shown, setShown] = createSignal(false);
  const reduceMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const toCobe = (ms: GlobeMarker[]) => ms.map((m) => ({ location: [m.lat, m.lon] as [number, number], size: m.size, id: m.id }));

  onMount(() => {
    let globe: Cobe;
    let [phi, theta] = [0.6, 0.3];
    let target: [number, number] | null = null;
    let aim: [number, number] | null = null;
    let drag: { x: number; y: number; phi: number; theta: number } | null = null;
    let spinning = true;
    let visible = true;
    let frame = 0;
    try {
      globe = createGlobe(canvas, {
        devicePixelRatio: Math.min(2, window.devicePixelRatio || 1),
        width: props.size,
        height: props.size,
        phi,
        theta,
        mapSamples: props.mapSamples ?? 16000,
        markers: toCobe(props.markers),
        markerElevation: 0.01,
        ...themeColors(),
      });
    } catch {
      setFailed(true);
      return;
    }

    const ease = (to: [number, number]) => {
      const d = Math.atan2(Math.sin(to[0] - phi), Math.cos(to[0] - phi)); // shortest way round
      phi += d * 0.08;
      theta += (to[1] - theta) * 0.08;
      return Math.abs(d) < 0.002 && Math.abs(to[1] - theta) < 0.002;
    };

    const loop = () => {
      frame = 0;
      if (!visible || document.hidden) return;
      const spin = spinning && !reduceMotion;
      if (target) {
        ease(target);
      } else if (aim && !drag) {
        if (ease(aim)) aim = null;
      } else if (!drag && spin) {
        phi += 0.0025;
      }
      globe.update({ phi, theta });
      setShown(true);
      if (spin || target || aim || drag) frame = requestAnimationFrame(loop);
    };
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
      props.onDragStart?.();
      kick();
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      phi = drag.phi + (e.clientX - drag.x) / 120;
      theta = Math.max(-1, Math.min(1, drag.theta + (e.clientY - drag.y) / 240));
      kick();
    };
    const onUp = () => (drag = null);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    createEffect(() => {
      globe.update({ markers: toCobe(props.markers) });
      kick();
    });
    createEffect(() => {
      spinning = props.spinning ?? true;
      kick();
    });
    createEffect(() => {
      const f = props.focus;
      target = f ? anglesFor(f) : null;
      kick();
    });
    createEffect(() => {
      const a = props.aim;
      if (!a) return;
      // Tilt is softened so far-north or far-south places don't show a pole.
      const [p, t] = anglesFor(a);
      aim = [p, t * 0.6];
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

  return (
    <Show
      when={!failed()}
      fallback={<p class="grid size-full place-items-center text-sm text-muted-foreground">Your browser can't show the globe.</p>}
    >
      <canvas
        ref={canvas}
        aria-label={props.label}
        role="img"
        class={cn("cursor-grab touch-none transition-opacity duration-700 active:cursor-grabbing", shown() ? "opacity-100" : "opacity-0")}
        style={{ width: `${props.size}px`, height: `${props.size}px` }}
      />
    </Show>
  );
}
