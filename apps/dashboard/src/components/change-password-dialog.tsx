import { useMutation } from "@tanstack/solid-query";
import { createSignal, Show } from "solid-js";
import { api } from "~/lib/api";
import { errorMessage, t } from "~/lib/i18n";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input, Label } from "./ui/input";

export function ChangePasswordDialog(props: { onClose: () => void }) {
  const [current, setCurrent] = createSignal("");
  const [next, setNext] = createSignal("");
  const change = useMutation(() => ({
    mutationFn: () => api.changePassword(current(), next()),
    onSuccess: () => props.onClose(),
  }));
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t().changePassword.title}</DialogTitle>
          <DialogDescription>{t().changePassword.description}</DialogDescription>
        </DialogHeader>
        <form
          class="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate();
          }}
        >
          <div class="grid gap-2">
            <Label for="pw-current">{t().changePassword.current}</Label>
            <Input id="pw-current" type="password" autocomplete="current-password" value={current()} onInput={(e) => setCurrent(e.currentTarget.value)} />
          </div>
          <div class="grid gap-2">
            <Label for="pw-new">{t().changePassword.next}</Label>
            <Input id="pw-new" type="password" autocomplete="new-password" minLength={8} value={next()} onInput={(e) => setNext(e.currentTarget.value)} />
          </div>
          <Show when={change.error}>
            <p class="text-sm text-destructive">{errorMessage(change.error)}</p>
          </Show>
          <DialogFooter>
            <Button variant="outline" onClick={props.onClose}>
              {t().common.cancel}
            </Button>
            <Button type="submit" disabled={!current() || next().length < 8 || change.isPending}>
              {t().changePassword.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
