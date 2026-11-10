import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { useNavigate } from "@tanstack/solid-router";
import { createSignal, For, Show } from "solid-js";
import { api } from "~/lib/api";
import { errorMessage, t } from "~/lib/i18n";
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
      navigate({ to: "/sites/$siteId/settings", params: { siteId: String(site.id) }, search: { welcome: true } });
    },
  }));

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t().addSite.title}</DialogTitle>
          <DialogDescription>{t().addSite.description}</DialogDescription>
        </DialogHeader>
        <form
          class="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div class="grid gap-2">
            <Label for="site-domain">{t().addSite.domain}</Label>
            <Input
              id="site-domain"
              placeholder="example.com"
              autocomplete="off"
              autofocus
              value={domain()}
              onInput={(e) => setDomain(e.currentTarget.value)}
              aria-invalid={create.isError}
            />
            <p class="text-xs text-muted-foreground">{t().addSite.domainHint}</p>
          </div>
          <div class="grid gap-2">
            <Label for="site-tz">{t().addSite.timezone}</Label>
            <NativeSelect id="site-tz" value={tz()} onChange={(e) => setTz(e.currentTarget.value)}>
              <For each={timezones()}>{(z) => (
                <option value={z} selected={z === tz()}>
                  {z.replaceAll("_", " ")}
                </option>
              )}</For>
            </NativeSelect>
          </div>
          <Show when={create.error}>
            <p class="text-sm text-destructive">{errorMessage(create.error)}</p>
          </Show>
          <DialogFooter>
            <Button variant="outline" onClick={() => props.onOpenChange(false)}>
              {t().common.cancel}
            </Button>
            <Button type="submit" disabled={!domain().trim() || create.isPending}>
              {create.isPending ? t().addSite.adding : t().addSite.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
