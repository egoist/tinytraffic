import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Link, useNavigate, useParams } from "@tanstack/solid-router";
import { ChevronsUpDown, Code, KeyRound, LogOut, Plus, Settings } from "lucide-solid";
import { createSignal, For, Show } from "solid-js";
import { api } from "~/lib/api";
import { useSignedIn } from "~/lib/auth";
import { siteName } from "~/lib/format";
import { AddSiteDialog } from "./add-site-dialog";
import { ChangePasswordDialog } from "./change-password-dialog";
import { Logo, LogoMark } from "./logo";
import { LanguageToggle } from "./language-toggle";
import { ThemeToggle } from "./theme-toggle";
import { Button, buttonVariants } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { t } from "~/lib/i18n";
import { ready } from "~/lib/query";

export function AppHeader() {
  const params = useParams({ strict: false });
  const siteId = () => (params() as { siteId?: string }).siteId;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const signedIn = useSignedIn();
  const sites = useQuery(() => ({ queryKey: ["sites"], queryFn: api.sites, enabled: !!siteId() && signedIn() === true }));
  // Signed-out viewers of a public dashboard can only look up that site.
  const site = useQuery(() => ({
    queryKey: ["site", siteId()],
    queryFn: () => api.site(siteId()!),
    enabled: !!siteId() && signedIn() === false,
  }));
  const current = () => ready(sites)?.find((s) => String(s.id) === siteId()) ?? ready(site);
  const currentName = () => {
    const s = current();
    return s ? siteName(s) : "…";
  };
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
        <Show when={signedIn() !== false} fallback={<LogoMark />}>
          <Link to="/" class="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t().header.allSites}>
            <Show when={siteId()} fallback={<Logo />}>
              <LogoMark />
            </Show>
          </Link>
        </Show>

        <Show when={siteId()}>
          {(id) => (
            <>
              <span class="text-lg font-light text-muted-foreground/50">/</span>
              <Show
                when={signedIn() !== false}
                fallback={<span class="truncate px-1 text-sm font-semibold">{currentName()}</span>}
              >
                <DropdownMenu placement="bottom-start">
                  <DropdownMenuTrigger as={Button} variant="ghost" size="sm" class="-ml-1 max-w-[60vw] gap-1.5 px-2 font-semibold">
                    <span class="truncate">{currentName()}</span>
                    <ChevronsUpDown class="text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent class="w-60">
                    <DropdownMenuLabel>{t().header.sites}</DropdownMenuLabel>
                    <For each={ready(sites) ?? []}>
                      {(s) => (
                        <DropdownMenuItem
                          checked={String(s.id) === id()}
                          onSelect={() => navigate({ to: "/sites/$siteId", params: { siteId: String(s.id) } })}
                        >
                          <span class="grid min-w-0">
                            <span class="truncate">{siteName(s)}</span>
                            <Show when={siteName(s) !== s.domain}>
                              <span class="truncate text-xs text-muted-foreground">{s.domain}</span>
                            </Show>
                          </span>
                        </DropdownMenuItem>
                      )}
                    </For>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setAdding(true)}>
                      <Plus /> {t().header.addSite}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </Show>
            </>
          )}
        </Show>

        <div class="ml-auto flex items-center gap-1">
          <Show when={signedIn() !== false && siteId()}>
            {(id) => (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t().header.siteSettings}
                onClick={() => navigate({ to: "/sites/$siteId/settings", params: { siteId: id() } })}
              >
                <Settings />
              </Button>
            )}
          </Show>
          <LanguageToggle />
          <ThemeToggle />
          <Show
            when={signedIn() !== false}
            fallback={
              // A full page load, so the dashboard starts over signed in.
              <a
                href={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`}
                class={buttonVariants({ variant: "outline", size: "sm", class: "ml-1" })}
              >
                {t().header.signIn}
              </a>
            }
          >
            <DropdownMenu placement="bottom-end">
              <DropdownMenuTrigger
                as="button"
                class="ml-1 grid size-8 cursor-pointer place-items-center rounded-full bg-card text-xs font-semibold shadow-xs ring ring-line outline-none hover:bg-accent active:bg-recessed active:shadow-none focus-visible:ring-2 focus-visible:ring-ring data-[expanded]:bg-accent"
                aria-label={t().header.account}
              >
                <KeyRound class="size-3.5 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent class="w-48">
                <DropdownMenuItem onSelect={() => navigate({ to: "/api-keys" })}>
                  <Code /> {t().header.apiKeys}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setChangingPassword(true)}>
                  <KeyRound /> {t().header.changePassword}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => logout.mutate()}>
                  <LogOut /> {t().header.signOut}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Show>
        </div>
      </div>
      <AddSiteDialog open={adding()} onOpenChange={setAdding} />
      <Show when={changingPassword()}>
        <ChangePasswordDialog onClose={() => setChangingPassword(false)} />
      </Show>
    </header>
  );
}
