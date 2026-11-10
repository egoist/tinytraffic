import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { useNavigate } from "@tanstack/solid-router";
import { createSignal, For, Show } from "solid-js";
import { api } from "~/lib/api";
import { localTimezone, timezones } from "~/lib/timezones";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input, Label, NativeSelect } from "./ui/input";

export function AddSiteDialog(props: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [domain, setDomain] = createSignal("");
  const [tz, setTz] = createSignal(localTimezone());
  const qc = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation(() => ({
    mutationFn: () => api.createSite(domain(), tz()),
    onSuccess: async (site) => {
      await qc.invalidateQueries({ queryKey: ["sites"] });
      props.onOpenChange(false);
      setDomain("");
      navigate({ to: "/$domain/settings", params: { domain: site.domain }, search: { welcome: true } });
    },
  }));

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a site</DialogTitle>
          <DialogDescription>You'll get a snippet to paste into your site's &lt;head&gt;.</DialogDescription>
        </DialogHeader>
        <form
          class="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div class="grid gap-2">
            <Label for="site-domain">Domain</Label>
            <Input
              id="site-domain"
              placeholder="example.com"
              autocomplete="off"
              autofocus
              value={domain()}
              onInput={(e) => setDomain(e.currentTarget.value)}
              aria-invalid={create.isError}
            />
            <p class="text-xs text-muted-foreground">Without www or https://. Subdomains count as separate sites.</p>
          </div>
          <div class="grid gap-2">
            <Label for="site-tz">Reporting timezone</Label>
            <NativeSelect id="site-tz" value={tz()} onChange={(e) => setTz(e.currentTarget.value)}>
              <For each={timezones()}>{(z) => (
                <option value={z} selected={z === tz()}>
                  {z.replaceAll("_", " ")}
                </option>
              )}</For>
            </NativeSelect>
          </div>
          <Show when={create.error}>
            <p class="text-sm text-destructive">{create.error?.message}</p>
          </Show>
          <DialogFooter>
            <Button variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!domain().trim() || create.isPending}>
              {create.isPending ? "Adding…" : "Add site"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
