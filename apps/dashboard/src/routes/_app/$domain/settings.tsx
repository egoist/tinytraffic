import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/solid-router";
import { ArrowLeft, CircleCheck, LoaderCircle } from "lucide-solid";
import { createEffect, createSignal, For, Show } from "solid-js";
import { CodeBlock, trackingSnippet } from "~/components/code-block";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input, Label, NativeSelect } from "~/components/ui/input";
import { api } from "~/lib/api";
import { timezones } from "~/lib/timezones";
import { ready } from "~/lib/query";

export const Route = createFileRoute("/_app/$domain/settings")({
  validateSearch: (s: Record<string, unknown>): { welcome?: boolean } => ({ welcome: s.welcome === true || undefined }),
  component: Settings,
});

function Settings() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const domain = () => params().domain;
  const sites = useQuery(() => ({ queryKey: ["sites"], queryFn: api.sites }));
  const site = () => ready(sites)?.find((s) => s.domain === domain());

  return (
    <div class="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          to="/$domain"
          params={{ domain: domain() }}
          class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft class="size-4" /> Dashboard
        </Link>
        <h1 class="mt-3 text-2xl font-semibold tracking-tight">Settings</h1>
      </div>

      <Show when={search().welcome}>
        <Card class="border-chart-1/30 bg-chart-wash p-5">
          <p class="font-medium">{domain()} is ready.</p>
          <p class="mt-1 text-sm text-muted-foreground">Paste the snippet below into your site's &lt;head&gt; and you're done.</p>
        </Card>
      </Show>

      <TrackingCard domain={domain()} hasData={(site()?.visitors_24h ?? 0) > 0} />

      <Show when={site()}>{(s) => <TimezoneCard domain={domain()} timezone={s().timezone} />}</Show>

      <DangerCard domain={domain()} />
    </div>
  );
}

function TrackingCard(props: { domain: string; hasData: boolean }) {
  const live = useQuery(() => ({
    queryKey: ["realtime", props.domain],
    queryFn: () => api.realtime(props.domain),
    refetchInterval: 5_000,
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tracking snippet</CardTitle>
        <CardDescription>Add it to every page, inside &lt;head&gt;. It's about 1 KB gzipped and sets no cookies.</CardDescription>
      </CardHeader>
      <CardContent class="grid gap-5">
        <CodeBlock code={trackingSnippet(props.domain)} />
        <div class="flex items-center gap-2 text-sm">
          <Show
            when={props.hasData || (ready(live)?.visitors ?? 0) > 0}
            fallback={
              <>
                <LoaderCircle class="size-4 animate-spin text-muted-foreground" />
                <span class="text-muted-foreground">Waiting for a pageview from {props.domain}…</span>
              </>
            }
          >
            <CircleCheck class="size-4 text-positive" />
            <span>Receiving data.</span>
          </Show>
        </div>
        <div class="grid gap-2 border-t pt-5">
          <h3 class="text-sm font-medium">Custom events</h3>
          <p class="text-sm text-muted-foreground">
            Track signups, purchases or anything else. They show up under Goals. Outbound link clicks are tracked automatically.
          </p>
          <CodeBlock code={`tinytraffic("Signup", { props: { plan: "pro" } })`} />
          <p class="text-xs text-muted-foreground">
            Exclude your own visits by running <code class="rounded bg-muted px-1 py-0.5">localStorage.tinytraffic_ignore = "true"</code> in your browser console on your site.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function TimezoneCard(props: { domain: string; timezone: string }) {
  const qc = useQueryClient();
  const [tz, setTz] = createSignal(props.timezone);
  createEffect(() => setTz(props.timezone));
  const save = useMutation(() => ({
    mutationFn: () => api.updateSite(props.domain, tz()),
    onSuccess: () => qc.invalidateQueries(),
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reporting timezone</CardTitle>
        <CardDescription>Days and hours in your reports start and end in this timezone.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          class="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <NativeSelect value={tz()} onChange={(e) => setTz(e.currentTarget.value)} class="sm:max-w-xs" aria-label="Timezone">
            <For each={timezones()}>{(z) => (
                <option value={z} selected={z === tz()}>
                  {z.replaceAll("_", " ")}
                </option>
              )}</For>
          </NativeSelect>
          <Button type="submit" variant="outline" disabled={tz() === props.timezone || save.isPending}>
            {save.isSuccess && tz() === props.timezone ? "Saved" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DangerCard(props: { domain: string }) {
  const [open, setOpen] = createSignal(false);
  const [confirm, setConfirm] = createSignal("");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation(() => ({
    mutationFn: () => api.deleteSite(props.domain),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["sites"] });
      navigate({ to: "/" });
    },
  }));
  return (
    <Card class="border-destructive/30">
      <CardHeader>
        <CardTitle>Delete site</CardTitle>
        <CardDescription>Removes the site and all of its stats. This can't be undone.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete {props.domain}
        </Button>
      </CardContent>
      <Dialog open={open()} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {props.domain}?</DialogTitle>
            <DialogDescription>All stats for this site will be deleted permanently.</DialogDescription>
          </DialogHeader>
          <form
            class="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (confirm() === props.domain) remove.mutate();
            }}
          >
            <div class="grid gap-2">
              <Label for="confirm-domain">
                Type <span class="font-semibold">{props.domain}</span> to confirm
              </Label>
              <Input id="confirm-domain" autocomplete="off" value={confirm()} onInput={(e) => setConfirm(e.currentTarget.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={confirm() !== props.domain || remove.isPending}>
                Delete site
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
