import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { ArrowLeft, KeyRound, Plus } from "lucide-solid";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { CodeBlock } from "~/components/code-block";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input, Label } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { api, type APIKey } from "~/lib/api";
import { timeAgo } from "~/lib/format";
import { ready } from "~/lib/query";

export const Route = createFileRoute("/_app/api-keys")({
  component: APIKeys,
});

const endpoints = [
  ["GET", "/api/v1/sites", "Sites and their last-24h visitors"],
  ["GET", "/api/v1/sites/{domain}/aggregate", "Visitors, visits, pageviews, bounce rate, duration"],
  ["GET", "/api/v1/sites/{domain}/timeseries", "The same metrics per hour, day or month"],
  ["GET", "/api/v1/sites/{domain}/breakdown/{dimension}", "Top pages, sources, countries, …"],
  ["GET", "/api/v1/sites/{domain}/realtime", "Visitors in the last 5 minutes"],
];

function APIKeys() {
  const keys = useQuery(() => ({ queryKey: ["keys"], queryFn: api.keys }));
  const sites = useQuery(() => ({ queryKey: ["sites"], queryFn: api.sites }));
  const [creating, setCreating] = createSignal(false);
  const [revoking, setRevoking] = createSignal<APIKey | null>(null);
  const origin = typeof location === "undefined" ? "" : location.origin;
  const exampleDomain = () => ready(sites)?.[0]?.domain ?? "example.com";

  return (
    <div class="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link to="/" class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft class="size-4" /> Sites
        </Link>
        <h1 class="mt-3 text-2xl font-semibold tracking-tight">API keys</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          Read your stats from scripts and other apps. Keys are read-only and work for every site.
        </p>
      </div>

      <Card>
        <div class="flex items-start justify-between gap-4 p-5">
          <div class="grid gap-1.5">
            <CardTitle>Keys</CardTitle>
            <CardDescription>Revoke a key to cut off the app using it.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Create key
          </Button>
        </div>
        <CardContent>
          <Switch>
            <Match when={keys.isPending}>
              <Skeleton class="h-14" />
            </Match>
            <Match when={ready(keys)?.length === 0}>
              <div class="flex flex-col items-center rounded-lg border border-dashed py-10 text-center">
                <KeyRound class="size-5 text-muted-foreground" />
                <p class="mt-3 text-sm text-muted-foreground">No keys yet.</p>
              </div>
            </Match>
            <Match when={ready(keys)}>
              {(list) => (
                <ul class="divide-y rounded-lg border">
                  <For each={list()}>
                    {(key) => (
                      <li class="flex items-center gap-4 px-4 py-3">
                        <div class="min-w-0 flex-1">
                          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                            <span class="truncate font-medium">{key.name}</span>
                            <code class="font-mono text-xs text-muted-foreground">{key.prefix}…</code>
                          </div>
                          <p class="mt-0.5 text-xs text-muted-foreground">
                            Created {timeAgo(key.created_at)} ·{" "}
                            {key.last_used_at ? `last used ${timeAgo(key.last_used_at)}` : "never used"}
                          </p>
                        </div>
                        <Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" onClick={() => setRevoking(key)}>
                          Revoke
                        </Button>
                      </li>
                    )}
                  </For>
                </ul>
              )}
            </Match>
          </Switch>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick start</CardTitle>
          <CardDescription>
            Send the key as a bearer token. Stats endpoints take the same <code class="font-mono text-xs">period</code> and{" "}
            <code class="font-mono text-xs">f</code> (filter) parameters as the dashboard URL.
          </CardDescription>
        </CardHeader>
        <CardContent class="grid gap-5">
          <CodeBlock
            code={`curl -H "Authorization: Bearer $TINYTRAFFIC_KEY" \\\n  "${origin}/api/v1/sites/${exampleDomain()}/aggregate?period=30d"`}
          />
          <div class="overflow-x-auto rounded-lg border">
            <table class="w-full text-sm">
              <tbody class="divide-y">
                <For each={endpoints}>
                  {([method, path, what]) => (
                    <tr>
                      <td class="py-2.5 pr-2 pl-4 align-top font-mono text-xs text-muted-foreground">{method}</td>
                      <td class="py-2.5 pr-4 align-top font-mono text-xs whitespace-nowrap">{path}</td>
                      <td class="py-2.5 pr-4 align-top text-muted-foreground">{what}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <p class="text-xs text-muted-foreground">
            Full reference: <code class="font-mono">docs/api.md</code> in the tinytraffic repository. Each key can make 600 requests
            a minute.
          </p>
        </CardContent>
      </Card>

      <Show when={creating()}>
        <CreateKeyDialog onClose={() => setCreating(false)} />
      </Show>
      <Show when={revoking()}>{(key) => <RevokeDialog apiKey={key()} onClose={() => setRevoking(null)} />}</Show>
    </div>
  );
}

function CreateKeyDialog(props: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = createSignal("");
  const create = useMutation(() => ({
    mutationFn: () => api.createKey(name().trim()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["keys"] }),
  }));
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent>
        <Show
          when={create.data?.token}
          fallback={
            <>
              <DialogHeader>
                <DialogTitle>Create API key</DialogTitle>
                <DialogDescription>Name it after the app that will use it, so you know what to revoke later.</DialogDescription>
              </DialogHeader>
              <form
                class="grid gap-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  create.mutate();
                }}
              >
                <div class="grid gap-2">
                  <Label for="key-name">Name</Label>
                  <Input
                    id="key-name"
                    placeholder="e.g. Weekly report script"
                    autocomplete="off"
                    autofocus
                    maxLength={100}
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                  />
                </div>
                <Show when={create.error}>
                  <p class="text-sm text-destructive">{create.error?.message}</p>
                </Show>
                <DialogFooter>
                  <Button variant="outline" onClick={props.onClose}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!name().trim() || create.isPending}>
                    Create key
                  </Button>
                </DialogFooter>
              </form>
            </>
          }
        >
          {(token) => (
            <>
              <DialogHeader>
                <DialogTitle>Copy your new key</DialogTitle>
                <DialogDescription>This is the only time it's shown. Store it somewhere safe, like your app's secrets.</DialogDescription>
              </DialogHeader>
              <CodeBlock code={token()} />
              <DialogFooter>
                <Button onClick={props.onClose}>Done</Button>
              </DialogFooter>
            </>
          )}
        </Show>
      </DialogContent>
    </Dialog>
  );
}

function RevokeDialog(props: { apiKey: APIKey; onClose: () => void }) {
  const qc = useQueryClient();
  const revoke = useMutation(() => ({
    mutationFn: () => api.deleteKey(props.apiKey.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["keys"] });
      props.onClose();
    },
  }));
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>Revoke “{props.apiKey.name}”?</DialogTitle>
          <DialogDescription>Apps using this key stop working right away. This can't be undone.</DialogDescription>
        </DialogHeader>
        <Show when={revoke.error}>
          <p class="text-sm text-destructive">{revoke.error?.message}</p>
        </Show>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
            Revoke key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
