import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { Plus } from "lucide-solid";
import { createSignal, For, Match, Switch } from "solid-js";
import { AddSiteDialog } from "~/components/add-site-dialog";
import { Sparkline } from "~/components/sparkline";
import { Button } from "~/components/ui/button";
import { Card, CardContent, Surface } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { api, type SiteWithStats } from "~/lib/api";
import { formatFull, formatNumber } from "~/lib/format";
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
          <h1 class="text-2xl font-semibold tracking-tight">Sites</h1>
          <p class="mt-1 text-sm text-muted-foreground">Unique visitors over the last 24 hours.</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus /> Add site
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
            <h2 class="mt-4 font-semibold">Add your first site</h2>
            <p class="mt-1 max-w-sm text-sm text-muted-foreground">
              One script tag, no cookies, no consent banner. Stats show up the moment someone visits.
            </p>
            <Button class="mt-6" onClick={() => setAdding(true)}>
              Add a site
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
  const initial = () => props.site.domain[0]?.toUpperCase() ?? "?";
  return (
    <Link
      to="/sites/$siteId"
      params={{ siteId: String(props.site.id) }}
      class="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card class="h-full transition-shadow group-hover:shadow-md group-hover:ring-line">
        <div class="flex items-center gap-2.5 px-4 py-2.5">
          <span class="grid size-6 shrink-0 place-items-center rounded-md bg-card text-xs font-semibold text-muted-foreground shadow-xs ring ring-line">
            {initial()}
          </span>
          <span class="truncate text-sm font-medium">{props.site.domain}</span>
        </div>
        <CardContent class="flex items-end justify-between gap-4">
          <div>
            <div class="text-2xl font-semibold tracking-tight tabular" title={formatFull(props.site.visitors_24h)}>
              {formatNumber(props.site.visitors_24h)}
            </div>
            <div class="text-xs text-muted-foreground">visitors</div>
          </div>
          <Sparkline values={props.site.sparkline} class="h-10 w-32" />
        </CardContent>
      </Card>
    </Link>
  );
}
