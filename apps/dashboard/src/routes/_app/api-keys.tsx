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
import { api, type APIKey, type APIKeyScope } from "~/lib/api";
import { cn } from "~/lib/utils";
import { timeAgo } from "~/lib/format";
import { errorMessage, t } from "~/lib/i18n";
import { ready } from "~/lib/query";

export const Route = createFileRoute("/_app/api-keys")({
  component: APIKeys,
});

/** Descriptions are `t().apiKeys.endpoints[i]`, in this order. */
const endpoints: [method: string, path: string, write?: boolean][] = [
  ["GET", "/api/v1/sites"],
  ["GET", "/api/v1/sites/{site}/aggregate"],
  ["GET", "/api/v1/sites/{site}/timeseries"],
  ["GET", "/api/v1/sites/{site}/breakdown/{dimension}"],
  ["GET", "/api/v1/sites/{site}/realtime"],
  ["POST", "/api/v1/sites", true],
  ["PATCH", "/api/v1/sites/{site}", true],
  ["DELETE", "/api/v1/sites/{site}", true],
  ["POST", "/api/event", true],
];

const scopes = (): { value: APIKeyScope; label: string; description: string }[] => [
  { value: "read", label: t().apiKeys.readOnly, description: t().apiKeys.readOnlyDescription },
  { value: "write", label: t().apiKeys.readWrite, description: t().apiKeys.readWriteDescription },
];

function ScopeBadge(props: { scope: APIKeyScope }) {
  return (
    <span
      class={cn(
        "rounded-full border px-2 py-0.5 text-[11px] font-medium",
        props.scope === "write" ? "border-foreground/20 text-foreground" : "text-muted-foreground",
      )}
    >
      {props.scope === "write" ? t().apiKeys.readWrite : t().apiKeys.readOnly}
    </span>
  );
}

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
          <ArrowLeft class="size-4" /> {t().apiKeys.back}
        </Link>
        <h1 class="mt-3 text-2xl font-semibold tracking-tight">{t().apiKeys.title}</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          {t().apiKeys.subtitle}
        </p>
      </div>

      <Card>
        <div class="flex items-center justify-between gap-4 py-2.5 pr-2.5 pl-5">
          <div class="grid gap-1">
            <CardTitle>{t().apiKeys.keys}</CardTitle>
            <CardDescription>{t().apiKeys.keysDescription}</CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> {t().apiKeys.create}
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
                <p class="mt-3 text-sm text-muted-foreground">{t().apiKeys.empty}</p>
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
                            <ScopeBadge scope={key.scope} />
                            <code class="font-mono text-xs text-muted-foreground">{key.prefix}…</code>
                          </div>
                          <p class="mt-0.5 text-xs text-muted-foreground">
                            {t().apiKeys.created(timeAgo(key.created_at))} ·{" "}
                            {key.last_used_at ? t().apiKeys.lastUsed(timeAgo(key.last_used_at)) : t().apiKeys.neverUsed}
                          </p>
                        </div>
                        <Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" onClick={() => setRevoking(key)}>
                          {t().apiKeys.revoke}
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
          <CardTitle>{t().apiKeys.quickStart}</CardTitle>
          <CardDescription>
            {t().apiKeys.quickStartDescription(
              <code class="font-mono text-xs">period</code>,
              <code class="font-mono text-xs">f</code>,
            )}
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
                  {([method, path, write], i) => (
                    <tr>
                      <td class="py-2.5 pr-2 pl-4 align-top font-mono text-xs text-muted-foreground">{method}</td>
                      <td class="py-2.5 pr-4 align-top font-mono text-xs whitespace-nowrap">{path}</td>
                      <td class="py-2.5 pr-4 align-top text-muted-foreground">
                        {t().apiKeys.endpoints[i()]}
                        <Show when={write}>
                          <span class="ml-2 align-middle">
                            <ScopeBadge scope="write" />
                          </span>
                        </Show>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <p class="text-xs text-muted-foreground">
            {t().apiKeys.reference(<code class="font-mono">docs/api.md</code>)}
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
  const [scope, setScope] = createSignal<APIKeyScope>("read");
  const create = useMutation(() => ({
    mutationFn: () => api.createKey(name().trim(), scope()),
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
                <DialogTitle>{t().apiKeys.createTitle}</DialogTitle>
                <DialogDescription>{t().apiKeys.createDescription}</DialogDescription>
              </DialogHeader>
              <form
                class="grid gap-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  create.mutate();
                }}
              >
                <div class="grid gap-2">
                  <Label for="key-name">{t().apiKeys.name}</Label>
                  <Input
                    id="key-name"
                    placeholder={t().apiKeys.namePlaceholder}
                    autocomplete="off"
                    autofocus
                    maxLength={100}
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                  />
                </div>
                <fieldset class="grid gap-2">
                  <legend class="mb-2 text-sm font-medium">{t().apiKeys.access}</legend>
                  <For each={scopes()}>
                    {(s) => (
                      <label
                        class={cn(
                          "flex cursor-pointer gap-3 rounded-lg bg-recessed p-3 ring ring-border transition-[background-color,box-shadow] hover:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                          scope() === s.value && "bg-card shadow-sm ring-line hover:bg-card",
                        )}
                      >
                        <input
                          type="radio"
                          name="scope"
                          value={s.value}
                          checked={scope() === s.value}
                          onChange={() => setScope(s.value)}
                          class="mt-0.5 accent-primary"
                        />
                        <span class="grid gap-0.5">
                          <span class="text-sm font-medium">{s.label}</span>
                          <span class="text-xs text-muted-foreground">{s.description}</span>
                        </span>
                      </label>
                    )}
                  </For>
                </fieldset>
                <Show when={create.error}>
                  <p class="text-sm text-destructive">{errorMessage(create.error)}</p>
                </Show>
                <DialogFooter>
                  <Button variant="outline" onClick={props.onClose}>
                    {t().common.cancel}
                  </Button>
                  <Button type="submit" disabled={!name().trim() || create.isPending}>
                    {t().apiKeys.create}
                  </Button>
                </DialogFooter>
              </form>
            </>
          }
        >
          {(token) => (
            <>
              <DialogHeader>
                <DialogTitle>{t().apiKeys.copyTitle}</DialogTitle>
                <DialogDescription>{t().apiKeys.copyDescription}</DialogDescription>
              </DialogHeader>
              <CodeBlock code={token()} />
              <DialogFooter>
                <Button onClick={props.onClose}>{t().apiKeys.done}</Button>
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
          <DialogTitle>{t().apiKeys.revokeTitle(props.apiKey.name)}</DialogTitle>
          <DialogDescription>{t().apiKeys.revokeDescription}</DialogDescription>
        </DialogHeader>
        <Show when={revoke.error}>
          <p class="text-sm text-destructive">{errorMessage(revoke.error)}</p>
        </Show>
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            {t().common.cancel}
          </Button>
          <Button variant="destructive" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
            {t().apiKeys.revokeSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
