import { Calendar, ChevronDown } from "lucide-solid";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { periods, type Period } from "~/lib/dims";
import { parseBucket } from "~/lib/format";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input, Label } from "./ui/input";

export type PeriodValue = { period: Period; from?: string; to?: string };

function fmtDay(s: string) {
  return parseBucket(s).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
}

export function periodLabel(v: PeriodValue) {
  if (v.period === "custom" && v.from && v.to) {
    return v.from === v.to ? fmtDay(v.from) : `${fmtDay(v.from)} – ${fmtDay(v.to)}`;
  }
  return periods.find((p) => p.value === v.period)?.label ?? "Last 30 days";
}

export function PeriodPicker(props: { value: PeriodValue; onChange: (v: PeriodValue) => void }) {
  const [customOpen, setCustomOpen] = createSignal(false);

  // Single-key shortcuts, as shown in the menu.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      const p = periods.find((p) => p.shortcut?.toLowerCase() === e.key.toLowerCase());
      if (p) {
        e.preventDefault();
        props.onChange({ period: p.value });
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  return (
    <>
      <DropdownMenu placement="bottom-end">
        <DropdownMenuTrigger as={Button} variant="outline" size="sm" class="min-w-40 justify-between">
          <span class="flex items-center gap-2">
            <Calendar class="text-muted-foreground" />
            {periodLabel(props.value)}
          </span>
          <ChevronDown class="text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-52">
          <For each={periods}>
            {(p, i) => (
              <>
                <Show when={i() > 0 && periods[i() - 1].group !== p.group}>
                  <DropdownMenuSeparator />
                </Show>
                <DropdownMenuItem
                  checked={props.value.period === p.value}
                  shortcut={props.value.period === p.value ? undefined : p.shortcut}
                  onSelect={() => props.onChange({ period: p.value })}
                >
                  {p.label}
                </DropdownMenuItem>
              </>
            )}
          </For>
          <DropdownMenuSeparator />
          <DropdownMenuItem checked={props.value.period === "custom"} onSelect={() => setCustomOpen(true)}>
            Custom range…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Show when={customOpen()}>
        <CustomRangeDialog
          initial={props.value}
          onClose={() => setCustomOpen(false)}
          onApply={(from, to) => {
            setCustomOpen(false);
            props.onChange({ period: "custom", from, to });
          }}
        />
      </Show>
    </>
  );
}

function CustomRangeDialog(props: { initial: PeriodValue; onClose: () => void; onApply: (from: string, to: string) => void }) {
  const today = new Date().toLocaleDateString("en-CA");
  const [from, setFrom] = createSignal(props.initial.from ?? today);
  const [to, setTo] = createSignal(props.initial.to ?? today);
  const valid = () => from() && to() && from() <= to();
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>Custom range</DialogTitle>
          <DialogDescription>Both days are included.</DialogDescription>
        </DialogHeader>
        <form
          class="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid()) props.onApply(from(), to());
          }}
        >
          <div class="grid grid-cols-2 gap-3">
            <div class="grid gap-2">
              <Label for="range-from">From</Label>
              <Input id="range-from" type="date" max={today} value={from()} onInput={(e) => setFrom(e.currentTarget.value)} />
            </div>
            <div class="grid gap-2">
              <Label for="range-to">To</Label>
              <Input id="range-to" type="date" max={today} value={to()} onInput={(e) => setTo(e.currentTarget.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid()}>
              Apply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
