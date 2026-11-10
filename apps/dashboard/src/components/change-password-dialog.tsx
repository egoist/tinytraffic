import { useMutation } from "@tanstack/solid-query";
import { createSignal, Show } from "solid-js";
import { api } from "~/lib/api";
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
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Other signed-in browsers will be signed out.</DialogDescription>
        </DialogHeader>
        <form
          class="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate();
          }}
        >
          <div class="grid gap-2">
            <Label for="pw-current">Current password</Label>
            <Input id="pw-current" type="password" autocomplete="current-password" value={current()} onInput={(e) => setCurrent(e.currentTarget.value)} />
          </div>
          <div class="grid gap-2">
            <Label for="pw-new">New password</Label>
            <Input id="pw-new" type="password" autocomplete="new-password" minLength={8} value={next()} onInput={(e) => setNext(e.currentTarget.value)} />
          </div>
          <Show when={change.error}>
            <p class="text-sm text-destructive">{change.error?.message}</p>
          </Show>
          <DialogFooter>
            <Button variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!current() || next().length < 8 || change.isPending}>
              Update password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
