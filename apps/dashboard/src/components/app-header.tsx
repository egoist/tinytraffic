import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Link, useNavigate, useParams } from "@tanstack/solid-router";
import { ChevronsUpDown, KeyRound, LogOut, Plus, Settings } from "lucide-solid";
import { createSignal, For, Show } from "solid-js";
import { api } from "~/lib/api";
import { AddSiteDialog } from "./add-site-dialog";
import { ChangePasswordDialog } from "./change-password-dialog";
import { Logo, LogoMark } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ready } from "~/lib/query";

export function AppHeader() {
  const params = useParams({ strict: false });
  const domain = () => (params() as { domain?: string }).domain;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const sites = useQuery(() => ({ queryKey: ["sites"], queryFn: api.sites, enabled: !!domain() }));
  const [adding, setAdding] = createSignal(false);
  const [changingPassword, setChangingPassword] = createSignal(false);
  const logout = useMutation(() => ({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.clear();
      navigate({ to: "/login" });
    },
  }));

  return (
    <header class="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link to="/" class="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label="All sites">
          <Show when={domain()} fallback={<Logo />}>
            <LogoMark />
          </Show>
        </Link>

        <Show when={domain()}>
          {(d) => (
            <>
              <span class="text-lg font-light text-muted-foreground/50">/</span>
              <DropdownMenu placement="bottom-start">
                <DropdownMenuTrigger as={Button} variant="ghost" size="sm" class="-ml-1 max-w-[60vw] gap-1.5 px-2 font-semibold">
                  <span class="truncate">{d()}</span>
                  <ChevronsUpDown class="text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent class="w-60">
                  <DropdownMenuLabel>Sites</DropdownMenuLabel>
                  <For each={ready(sites) ?? []}>
                    {(s) => (
                      <DropdownMenuItem
                        checked={s.domain === d()}
                        onSelect={() => navigate({ to: "/$domain", params: { domain: s.domain } })}
                      >
                        <span class="truncate">{s.domain}</span>
                      </DropdownMenuItem>
                    )}
                  </For>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setAdding(true)}>
                    <Plus /> Add site
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </Show>

        <div class="ml-auto flex items-center gap-1">
          <Show when={domain()}>
            {(d) => (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Site settings"
                onClick={() => navigate({ to: "/$domain/settings", params: { domain: d() } })}
              >
                <Settings />
              </Button>
            )}
          </Show>
          <ThemeToggle />
          <DropdownMenu placement="bottom-end">
            <DropdownMenuTrigger
              as="button"
              class="ml-1 grid size-8 cursor-pointer place-items-center rounded-full bg-secondary text-xs font-semibold outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label="Account"
            >
              <KeyRound class="size-3.5 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-48">
              <DropdownMenuItem onSelect={() => setChangingPassword(true)}>
                <KeyRound /> Change password
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => logout.mutate()}>
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <AddSiteDialog open={adding()} onOpenChange={setAdding} />
      <Show when={changingPassword()}>
        <ChangePasswordDialog onClose={() => setChangingPassword(false)} />
      </Show>
    </header>
  );
}
