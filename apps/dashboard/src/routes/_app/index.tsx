import { useQuery } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { Plus } from "lucide-solid";
import { createSignal, For, Match, Switch } from "solid-js";
import { AddSiteDialog } from "~/components/add-site-dialog";
import { Sparkline } from "~/components/sparkline";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
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
            <For each={[1, 2, 3]}>{() => <Skeleton class="h-40 rounded-xl" />}</For>
          </div>
        </Match>
        <Match when={ready(sites)?.length === 0}>
          <Card class="flex flex-col items-center px-6 py-16 text-center">
            <div class="grid size-12 place-items-center rounded-full bg-secondary">
              <Plus class="size-5 text-muted-foreground" />
            </div>
            <h2 class="mt-4 font-semibold">Add your first site</h2>
            <p class="mt-1 max-w-sm text-sm text-muted-foreground">
              One script tag, no cookies, no consent banner. Stats show up the moment someone visits.
            </p>
            <Button class="mt-6" onClick={() => setAdding(true)}>
              Add a site
            </Button>
          </Card>
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
      class="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Card class="flex h-full flex-col gap-5 p-5 transition-[border-color,box-shadow] group-hover:border-foreground/15 group-hover:shadow-sm">
        <div class="flex items-center gap-3">
          <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-sm font-semibold text-muted-foreground">
            {initial()}
          </span>
          <span class="truncate font-medium">{props.site.domain}</span>
        </div>
        <div class="flex items-end justify-between gap-4">
          <div>
            <div class="text-2xl font-semibold tracking-tight tabular" title={formatFull(props.site.visitors_24h)}>
              {formatNumber(props.site.visitors_24h)}
            </div>
            <div class="text-xs text-muted-foreground">visitors</div>
          </div>
          <Sparkline values={props.site.sparkline} class="h-10 w-32" />
        </div>
      </Card>
    </Link>
  );
}
