import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { Plus } from "lucide-solid";
import { createEffect, createSignal, For, Match, Show, Switch } from "solid-js";
import { AddSiteDialog } from "~/components/add-site-dialog";
import { Realtime } from "~/components/realtime";
import { Sparkline } from "~/components/sparkline";
import { Button } from "~/components/ui/button";
import { Card, CardContent, Surface } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { api, type SiteWithStats } from "~/lib/api";
import { formatFull, formatNumber, siteName } from "~/lib/format";
import { t } from "~/lib/i18n";
import { ready } from "~/lib/query";

export const Route = createFileRoute("/_app/")({
  component: Sites,
});

function Sites() {
  const sites = useQuery(() => ({ queryKey: ["sites"], queryFn: api.sites, refetchInterval: 60_000 }));
  const [adding, setAdding] = createSignal(false);

  return (
    <div>
      <div class="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">{t().sites.title}</h1>
          <p class="mt-1 text-sm text-muted-foreground">{t().sites.subtitle}</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus /> {t().sites.add}
        </Button>
      </div>

      <Switch>
        <Match when={sites.isPending}>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <For each={[1, 2, 3]}>{() => <Skeleton class="h-[154px] rounded-xl" />}</For>
          </div>
        </Match>
        <Match when={ready(sites)?.length === 0}>
          <Surface class="flex flex-col items-center px-6 py-16 text-center">
            <div class="grid size-12 place-items-center rounded-full bg-recessed shadow-[inset_0_1px_2px_0_rgb(0_0_0/0.06)] ring ring-border">
              <Plus class="size-5 text-muted-foreground" />
            </div>
            <h2 class="mt-4 font-semibold">{t().sites.emptyTitle}</h2>
            <p class="mt-1 max-w-sm text-sm text-muted-foreground">
              {t().sites.emptyBody}
            </p>
            <Button class="mt-6" onClick={() => setAdding(true)}>
              {t().sites.addFirst}
            </Button>
          </Surface>
        </Match>
        <Match when={ready(sites)}>
          {(list) => (
            <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <For each={list()}>{(site) => <SiteCard site={site} />}</For>
            </div>
          )}
        </Match>
      </Switch>

      <AddSiteDialog open={adding()} onOpenChange={setAdding} />
    </div>
  );
}

function SiteCard(props: { site: SiteWithStats }) {
  const name = () => siteName(props.site);
  const initial = () => name()[0]?.toUpperCase() ?? "?";
  const [faviconLoaded, setFaviconLoaded] = createSignal(false);
  createEffect(() => {
    props.site.domain;
    setFaviconLoaded(false);
  });

  return (
    <Link
      to="/sites/$siteId"
      params={{ siteId: String(props.site.id) }}
      class="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card class="h-full transition-shadow group-hover:shadow-md group-hover:ring-line">
        <div class="flex items-center gap-2.5 px-4 py-2.5">
          <span class="relative grid size-6 shrink-0 place-items-center rounded-md bg-card text-xs font-semibold text-muted-foreground shadow-xs ring ring-line">
            <Show when={!faviconLoaded()}>{initial()}</Show>
            <img
              src={`/api/sites/${props.site.id}/favicon?v=2&domain=${encodeURIComponent(props.site.domain)}`}
              alt=""
              class="absolute size-4 object-contain"
              classList={{ "opacity-0": !faviconLoaded() }}
              loading="lazy"
              decoding="async"
              onLoad={() => setFaviconLoaded(true)}
              onError={() => setFaviconLoaded(false)}
            />
          </span>
          <div class="grid min-w-0">
            <span class="truncate text-sm font-medium">{name()}</span>
            <Show when={name() !== props.site.domain}>
              <span class="truncate text-xs text-muted-foreground">{props.site.domain}</span>
            </Show>
          </div>
        </div>
        <CardContent class="flex items-end justify-between gap-4">
          <div>
            <div class="text-2xl font-semibold tracking-tight tabular" title={formatFull(props.site.visitors_24h)}>
              {formatNumber(props.site.visitors_24h)}
            </div>
            <div class="text-xs text-muted-foreground">{t().sites.visitors}</div>
            <div class="mt-2">
              <Realtime site={String(props.site.id)} />
            </div>
          </div>
          <Sparkline values={props.site.sparkline} class="h-10 w-32" />
        </CardContent>
      </Card>
    </Link>
  );
}
