import { keepPreviousData, useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/solid-router";
import { Clock, Laptop, MapPinOff, Monitor, MousePointerClick, Pause, Play, Smartphone, Tablet, X } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js";
import { canPin, Globe, pinnedTo, type LatLon } from "~/components/globe";
import { Logo, LogoMark } from "~/components/logo";
import { Button } from "~/components/ui/button";
import { api, type LiveEvent, type LiveSession } from "~/lib/api";
import { valueLabel } from "~/lib/dims";
import { countryName, flag, formatNumber } from "~/lib/format";
import { t } from "~/lib/i18n";
import { ready } from "~/lib/query";
import { cn } from "~/lib/utils";

export const Route = createFileRoute("/_app/sites/$siteId/live")({
  component: LivePage,
});

const POLL_MS = 4000;
const FEED = 4;
/** Turn to new activity at most this often, so steady traffic doesn't whip the globe around. */
const AIM_EVERY_MS = 8000;

/** Visitors in and around one city. */
type Place = LatLon & {
  id: string;
  /** The city most of them are in. */
  country: string;
  region: string;
  city: string;
  /** The other cities nearby. */
  others: string[];
  sessions: LiveSession[];
};

/**
 * Visitors this close (in degrees of arc, about 500 km) share a sticker, so
 * neighboring cities don't pile up; a sticker covers about that much globe.
 */
const NEARBY_DEGREES = 5;

function arcDegrees(a: LatLon, b: LatLon) {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / r;
}

// IDs become CSS idents, so no dots.
const placeId = (p: LatLon) => `p${Math.round(p.lat * 100)}_${Math.round(p.lon * 100)}`;
const placeName = (p: { city: string; region: string; country: string }) =>
  p.city || p.region || countryName(p.country) || t().live.somewhere;
const eventKey = (e: LiveEvent) => `${e.ts}|${e.session}|${e.name}|${e.page}`;

/** "now", "12s", "4m", "1h 5m". */
function short(ms: number) {
  const u = t().units;
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return u.now;
  if (s < 60) return `${s}${u.s}`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}${u.m}`;
  return `${Math.floor(m / 60)}${u.h}${u.sep}${m % 60}${u.m}`;
}

const deviceIcons: Record<string, (p: { class?: string }) => JSX.Element> = {
  Mobile: Smartphone,
  Tablet: Tablet,
  Laptop: Laptop,
  Desktop: Monitor,
};

function LivePage() {
  const params = Route.useParams();
  const siteId = () => params().siteId;
  const router = useRouter();
  const navigate = useNavigate();
  // Back to the dashboard as it was (period, filters), or to its default view
  // when this page was opened directly.
  const close = () => {
    if (router.history.canGoBack()) router.history.back();
    else navigate({ to: "/sites/$siteId", params: { siteId: siteId() } });
  };

  const live = useQuery(() => ({
    queryKey: ["live", siteId()],
    queryFn: () => api.live(siteId()),
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
  }));
  const sites = useQuery(() => ({ queryKey: ["sites"], queryFn: api.sites }));
  const info = useQuery(() => ({ queryKey: ["info"], queryFn: api.info, staleTime: Infinity }));
  const domain = () => ready(sites)?.find((s) => String(s.id) === siteId())?.domain;

  const data = () => ready(live);
  const sessions = () => data()?.sessions ?? [];
  const sessionById = createMemo(() => new Map(sessions().map((s) => [s.id, s])));

  // Group visitors around the longest-staying one in each area, so a place
  // keeps its ID (and its sticker) while newer visitors come and go.
  const places = createMemo(() => {
    const groups: { id: string; at: LatLon; sessions: LiveSession[] }[] = [];
    const located = sessions().filter((s) => s.lat !== null && s.lon !== null);
    located.sort((a, b) => a.started_at.localeCompare(b.started_at));
    for (const s of located) {
      const at = { lat: s.lat!, lon: s.lon! };
      const g = groups.find((g) => arcDegrees(g.at, at) < NEARBY_DEGREES);
      if (g) g.sessions.push(s);
      else groups.push({ id: placeId(at), at, sessions: [s] });
    }
    const m = new Map<string, Place>();
    const bySession = new Map<string, Place>();
    for (const { id, sessions: group } of groups) {
      const byCity = new Map<string, LiveSession[]>();
      for (const s of group) byCity.set(placeName(s), [...(byCity.get(placeName(s)) ?? []), s]);
      const cities = [...byCity].sort((a, b) => b[1].length - a[1].length);
      const main = cities[0][1][0];
      const mean = (f: (s: LiveSession) => number) => group.reduce((sum, s) => sum + f(s), 0) / group.length;
      m.set(id, {
        id,
        lat: mean((s) => s.lat!),
        lon: mean((s) => s.lon!),
        country: main.country,
        region: main.region,
        city: main.city,
        others: cities.slice(1).map(([name]) => name),
        sessions: [...group].sort((a, b) => b.last_seen.localeCompare(a.last_seen)),
      });
      for (const s of group) bySession.set(s.id, m.get(id)!);
    }
    return { byId: m, bySession };
  });
  const placeMap = () => places().byId;
  // Strings, so <For> keeps each sticker's element across polls.
  const placeIds = createMemo(() => [...placeMap().keys()]);
  const placeOf = (s: LiveSession | undefined) => (s ? places().bySession.get(s.id) : undefined);
  const markers = createMemo(() => [...placeMap().values()].map((p) => ({ id: p.id, lat: p.lat, lon: p.lon, size: 0.02 })));

  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(tick));

  const [selected, setSelected] = createSignal<string | null>(null);
  const selectedPlace = () => {
    const id = selected();
    return id ? placeMap().get(id) : undefined;
  };
  // Everyone there left.
  createEffect(() => {
    if (selected() && !selectedPlace()) setSelected(null);
  });
  const [spinning, setSpinning] = createSignal(true);

  // New activity: pulse the place it came from, and now and then turn to it.
  const [pulses, setPulses] = createSignal<Record<string, number>>({});
  const [aim, setAim] = createSignal<(LatLon & { key: number }) | null>(null);
  let seen: Set<string> | null = null;
  let lastAim = 0;
  let lastDrag = 0;
  const aimAt = (p: Place) => {
    lastAim = Date.now();
    setAim({ lat: p.lat, lon: p.lon, key: lastAim });
  };
  createEffect(
    on(
      () => data()?.events,
      (events) => {
        if (!events) return;
        const first = seen === null;
        const fresh = first ? [] : events.filter((e) => !seen!.has(eventKey(e)));
        seen = new Set(events.map(eventKey));
        if (first) {
          const p = placeOf(sessionById().get(events[0]?.session ?? "")) ?? [...placeMap().values()][0];
          if (p) aimAt(p);
          return;
        }
        if (fresh.length === 0) return;
        const bumped = { ...pulses() };
        for (const e of fresh) {
          const p = placeOf(sessionById().get(e.session));
          if (p) bumped[p.id] = (bumped[p.id] ?? 0) + 1;
        }
        setPulses(bumped);
        const t = Date.now();
        const p = placeOf(sessionById().get(fresh[0].session));
        if (p && !selected() && spinning() && t - lastAim > AIM_EVERY_MS && t - lastDrag > AIM_EVERY_MS) aimAt(p);
      },
    ),
  );

  // Keys rather than objects, so only new entries animate in.
  const eventByKey = createMemo(() => new Map((data()?.events ?? []).map((e) => [eventKey(e), e])));
  const feed = createMemo(() => [...eventByKey().keys()].slice(0, FEED).reverse());

  const counts = <T,>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
  };
  const topPages = createMemo(() => counts(sessions(), (s) => s.page));
  const topSources = createMemo(() => counts(sessions(), (s) => s.source));
  const topCountries = createMemo(() => counts(sessions(), (s) => s.country));

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (selected()) setSelected(null);
        else close();
      } else if (e.key.toLowerCase() === "l") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const select = (id: string | null) => {
    setSelected(id === selected() ? null : id);
  };

  return (
    <div class="fixed inset-0 z-50 overflow-hidden bg-background">
      {/* Globe, centered between the top bar and the activity feed. */}
      <div
        class="absolute inset-x-0 top-16 bottom-40 grid place-items-center lg:bottom-36"
        onClick={(e) => e.target === e.currentTarget && setSelected(null)}
      >
        <div
          aria-hidden="true"
          class="pointer-events-none absolute top-1/2 left-1/2 size-[min(140vw,140vh)] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(closest-side,var(--chart-wash),transparent)] opacity-70"
        />
        <Globe
          label={t().live.globe(domain())}
          class="w-[min(calc(100vw-2rem),calc(100dvh-14rem),56rem)] lg:w-[min(calc(100vw-38rem),calc(100dvh-13rem),56rem)]"
          mapSamples={20000}
          markers={markers()}
          focus={selectedPlace() ?? null}
          aim={aim()}
          spinning={spinning() && !selected()}
          onDragStart={() => {
            lastDrag = Date.now();
            setSelected(null);
          }}
        >
          <Show when={canPin}>
            <For each={placeIds()}>
              {(id) => (
                <Show when={placeMap().get(id)}>
                  {(p) => (
                    <Sticker place={p()} pulse={pulses()[id] ?? 0} selected={selected() === id} onClick={() => select(id)} />
                  )}
                </Show>
              )}
            </For>
          </Show>
        </Globe>
      </div>

      {/* Outside the globe's box, so it can sit beside the sticker anywhere on the page. */}
      <Show when={selectedPlace()}>
        {(p) => <PlaceCard place={p()} now={now()} onClose={() => setSelected(null)} />}
      </Show>

      {/* Top bar */}
      <header class="absolute inset-x-0 top-0 z-30 flex h-16 items-center gap-3 px-4 sm:px-6">
        <Link to="/" class="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t().header.allSites}>
          <LogoMark class="sm:hidden" />
          <Logo class="max-sm:hidden" />
        </Link>
        <div class="absolute left-1/2 flex h-9 -translate-x-1/2 items-center gap-3 rounded-full bg-card px-4 text-sm whitespace-nowrap shadow-xs ring ring-line">
          <span class="flex items-center gap-2" title={t().realtime.title}>
            <span class="relative flex size-2">
              <span class="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-60" />
              <span class="relative inline-flex size-2 rounded-full bg-live" />
            </span>
            <span>
              <span class="font-medium tabular">{data() ? formatNumber(data()!.visitors) : "–"}</span>{" "}
              <span class="text-muted-foreground">{t().live.online}</span>
            </span>
          </span>
          <span class="h-4 w-px bg-border max-sm:hidden" />
          <span class="max-w-[30vw] truncate font-medium max-sm:hidden">{domain() ?? "…"}</span>
        </div>
        <Button variant="ghost" size="sm" class="ml-auto text-muted-foreground max-sm:px-2" onClick={close} aria-label={t().common.close}>
          <X /> <span class="max-sm:hidden">{t().common.close}</span>
        </Button>
      </header>

      {/* Left: what this is and how to use it */}
      <aside class="absolute top-20 left-6 z-10 hidden w-64 lg:block">
        <h1 class="text-xl font-semibold tracking-tight">{t().live.title}</h1>
        <ul class="mt-3 grid gap-2 text-sm text-muted-foreground">
          <li class="flex items-center gap-2">
            <Clock class="size-4 shrink-0" /> {t().live.lastMinutes}
          </li>
          <li class="flex items-center gap-2">
            <MousePointerClick class="size-4 shrink-0" /> {t().live.clickVisitor}
          </li>
          <li>
            <button
              type="button"
              class="-mx-1 flex cursor-pointer items-center gap-2 rounded-md px-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setSpinning(!spinning())}
            >
              <Show when={spinning()} fallback={<Play class="size-4 shrink-0" />}>
                <Pause class="size-4 shrink-0" />
              </Show>
              {spinning() ? t().live.stopSpinning : t().live.startSpinning}
            </button>
          </li>
          <li class="flex items-center gap-2">
            {t().live.toClose(<Kbd>Esc</Kbd>)}
          </li>
          <li class="flex items-center gap-2">
            {t().live.toToggle(<Kbd>L</Kbd>)}
          </li>
          <Show when={ready(info)?.geoip.enabled === false}>
            <li class="flex items-start gap-2 pt-2 text-xs">
              <MapPinOff class="mt-px size-4 shrink-0" /> {t().live.geoipNeeded}
            </li>
          </Show>
        </ul>
      </aside>

      {/* Right: what's happening right now */}
      <Show when={sessions().length > 0}>
        <aside class="absolute top-20 right-6 z-10 hidden w-64 gap-6 lg:grid">
          <TopList
            title={t().live.pages}
            rows={topPages()}
            total={sessions().length}
            label={(v) => <span class="truncate" title={v}>{valueLabel("page", v)}</span>}
          />
          <TopList
            title={t().live.sources}
            rows={topSources()}
            total={sessions().length}
            label={(v) => <span class="truncate">{valueLabel("source", v)}</span>}
          />
          <TopList
            title={t().live.countries}
            rows={topCountries()}
            total={sessions().length}
            label={(v) => (
              <>
                <span class="text-base leading-none">{flag(v)}</span> <span class="truncate">{valueLabel("country", v)}</span>
              </>
            )}
          />
        </aside>
      </Show>

      {/* Bottom: newest activity, newest last */}
      <div class="absolute inset-x-0 bottom-6 z-20 flex flex-col items-center gap-2 px-4" aria-live="polite">
        <Show when={live.error?.message === "site not found"}>
          <p class="text-sm text-muted-foreground">
            {t().common.siteNotFound}{" "}
            <Link to="/" class="underline underline-offset-4 hover:text-foreground">
              {t().common.backToSites}
            </Link>
          </p>
        </Show>
        <Show when={data() && feed().length === 0}>
          <p class="text-sm text-muted-foreground">{t().live.noActivity}</p>
        </Show>
        <For each={feed()}>
          {(key, i) => {
            const e = eventByKey().get(key)!;
            const session = () => sessionById().get(e.session);
            const place = () => placeOf(session());
            return (
              <button
                type="button"
                class="flex max-w-full animate-in cursor-pointer items-center gap-2 rounded-full bg-card/90 px-3.5 py-1.5 text-sm shadow-xs ring ring-line backdrop-blur transition-opacity duration-500 outline-none fade-in slide-in-from-bottom-2 hover:opacity-100! focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                style={{ opacity: [0.35, 0.55, 0.8, 1][i() + FEED - feed().length] }}
                disabled={!place()}
                onClick={() => {
                  const p = place();
                  if (p) setSelected(p.id);
                }}
              >
                <span class="text-base leading-none">{flag(session()?.country ?? "")}</span>
                <span class="min-w-0 truncate text-muted-foreground">
                  {(() => {
                    const place = <span class="font-medium text-foreground">{session() ? placeName(session()!) : t().live.aNewPlace}</span>;
                    const page = <span class="font-medium text-foreground">{e.page}</span>;
                    return e.name === "pageview"
                      ? t().live.viewed(place, page)
                      : t().live.triggered(place, <span class="font-medium text-foreground">{e.name}</span>, page);
                  })()}
                </span>
                <span class="shrink-0 text-xs text-muted-foreground tabular">{short(now() - new Date(e.ts).getTime())}</span>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}

function Kbd(props: { children: JSX.Element }) {
  return (
    <kbd class="inline-grid h-5 min-w-5 place-items-center rounded bg-card px-1 font-sans text-[11px] font-medium text-muted-foreground shadow-xs ring ring-line">
      {props.children}
    </kbd>
  );
}

/** A visitor (or a few) at their city, pinned to the globe. */
function Sticker(props: { place: Place; pulse: number; selected: boolean; onClick: () => void }) {
  const n = () => props.place.sessions.length;
  return (
    <button
      type="button"
      class={cn(
        "absolute z-10 grid size-9 cursor-pointer place-items-center rounded-full bg-card text-lg shadow-md ring ring-line transition-[opacity,scale,box-shadow] duration-300 outline-none hover:z-[15] hover:ring-foreground/20 focus-visible:z-[15] focus-visible:ring-2 focus-visible:ring-ring",
        props.selected && "z-[15] ring-2 ring-ring hover:ring-ring",
      )}
      style={pinnedTo(props.place.id)}
      aria-label={t().live.visitorsIn(n(), placeName(props.place))}
      aria-pressed={props.selected}
      onClick={props.onClick}
    >
      {/* Restarts on each new event from here. */}
      <Show when={props.pulse} keyed>
        <span class="pointer-events-none absolute inset-0 animate-[sticker-ping_1.4s_ease-out_forwards] rounded-full ring-2 ring-live" />
      </Show>
      <span class="leading-none">{flag(props.place.country)}</span>
      <Show when={n() > 1}>
        <span class="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-foreground px-1 text-[10px] font-semibold text-background tabular">
          {n()}
        </span>
      </Show>
    </button>
  );
}

/** Who is at a place and what they're doing. */
function PlaceCard(props: { place: Place; now: number; onClose: () => void }) {
  const MAX = 4;
  const where = () => {
    const p = props.place;
    const sep = t().common.listSep;
    if (p.others.length > 2) return t().live.andMore(p.others.slice(0, 2).join(sep), p.others.length - 2);
    if (p.others.length) return t().live.andOthers(p.others.join(sep));
    return [p.city && p.region !== p.city ? p.region : "", countryName(p.country)].filter(Boolean).join(sep);
  };
  return (
    <div
      class={cn(
        "absolute z-20 max-h-[min(24rem,60dvh)] w-72 animate-in overflow-y-auto rounded-xl bg-popover text-popover-foreground shadow-lg ring ring-line fade-in zoom-in-95 duration-200",
        canPin ? "pinned-card" : "top-20 left-1/2 -translate-x-1/2",
      )}
      style={
        canPin
          ? { "--anchor": `--cobe-${props.place.id}`, opacity: `var(--cobe-visible-${props.place.id}, 0)` }
          : undefined
      }
      role="dialog"
      aria-label={t().live.visitorsAt(placeName(props.place))}
    >
      <div class="flex items-start gap-3 px-4 pt-3 pb-2">
        <span class="mt-0.5 text-xl leading-none">{flag(props.place.country)}</span>
        <div class="min-w-0 flex-1">
          <div class="truncate font-semibold">{placeName(props.place)}</div>
          <Show when={where()}>
            <div class="truncate text-xs text-muted-foreground">{where()}</div>
          </Show>
        </div>
        <Button variant="ghost" size="icon-sm" class="-mt-1 -mr-2 size-7" aria-label={t().common.close} onClick={props.onClose}>
          <X />
        </Button>
      </div>
      <ul class="grid grid-cols-[minmax(0,1fr)] gap-px px-1.5 pb-1.5">
        <For each={props.place.sessions.slice(0, MAX)}>
          {(s) => {
            const Device = deviceIcons[s.device];
            const active = () => props.now - new Date(s.last_seen).getTime() < 60_000;
            return (
              <li class="grid grid-cols-[minmax(0,1fr)] gap-0.5 rounded-lg px-2.5 py-2 hover:bg-accent">
                <div class="flex items-center gap-2">
                  <span
                    class={cn("size-1.5 shrink-0 rounded-full", active() ? "bg-live" : "bg-muted-foreground/40")}
                    title={active() ? t().live.activeLastMinute : t().live.lastSeen(short(props.now - new Date(s.last_seen).getTime()))}
                  />
                  <span class="min-w-0 flex-1 truncate text-sm font-medium" title={s.page}>
                    {s.page}
                  </span>
                  <span class="shrink-0 text-xs text-muted-foreground tabular" title={t().live.timeOnSite}>
                    {short(props.now - new Date(s.started_at).getTime())}
                  </span>
                </div>
                <div class="flex items-center gap-1.5 pl-3.5 text-xs text-muted-foreground">
                  {Device && <Device class="size-3 shrink-0" />}
                  <span class="truncate">
                    {[
                      props.place.others.length ? placeName(s) : "",
                      valueLabel("source", s.source),
                      s.browser && s.os ? t().live.browserOn(s.browser, s.os) : s.browser || s.os,
                      t().live.pageCount(s.pageviews),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              </li>
            );
          }}
        </For>
        <Show when={props.place.sessions.length > MAX}>
          <li class="px-2.5 py-1.5 text-xs text-muted-foreground">{t().live.more(props.place.sessions.length - MAX)}</li>
        </Show>
      </ul>
    </div>
  );
}

function TopList(props: { title: string; rows: [string, number][]; total: number; label: (v: string) => JSX.Element }) {
  return (
    <section>
      <h2 class="mb-1.5 text-xs font-medium text-muted-foreground">{props.title}</h2>
      <ul class="grid gap-0.5">
        <For each={props.rows}>
          {([value, n]) => (
            <li class="relative flex h-7 items-center gap-2 overflow-hidden rounded-md px-2 text-sm">
              <span
                class="absolute inset-y-0 left-0 rounded-md bg-bar transition-[width] duration-500"
                style={{ width: `${(n / Math.max(1, props.total)) * 100}%` }}
              />
              <span class="relative flex min-w-0 flex-1 items-center gap-2">{props.label(value)}</span>
              <span class="relative font-medium tabular">{formatNumber(n)}</span>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}
