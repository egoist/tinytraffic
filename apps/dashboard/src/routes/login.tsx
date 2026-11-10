import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/solid-router";
import { createSignal, Show } from "solid-js";
import { isServer } from "solid-js/web";
import { LanguageToggle } from "~/components/language-toggle";
import { Logo } from "~/components/logo";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input, Label } from "~/components/ui/input";
import { api } from "~/lib/api";
import { errorMessage, t } from "~/lib/i18n";
import { ready } from "~/lib/query";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof s.redirect === "string" && s.redirect.startsWith("/") ? s.redirect : undefined,
  }),
  beforeLoad: async ({ context, search }) => {
    if (isServer) return;
    const auth = await context.queryClient.fetchQuery({ queryKey: ["auth"], queryFn: api.auth });
    if (auth.authenticated) throw redirect({ href: search.redirect ?? "/" });
  },
  component: Login,
});

function Login() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const auth = useQuery(() => ({ queryKey: ["auth"], queryFn: api.auth }));
  const setup = () => ready(auth)?.needs_setup ?? false;
  const [password, setPassword] = createSignal("");
  const [confirm, setConfirm] = createSignal("");

  const submit = useMutation(() => ({
    mutationFn: async () => {
      if (setup()) {
        if (password() !== confirm()) throw new Error(t().login.mismatch);
        return api.setup(password());
      }
      return api.login(password());
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["auth"] });
      navigate({ href: search().redirect ?? "/" });
    },
  }));

  return (
    <main class="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div class="w-full max-w-sm">
        <div class="mb-8 flex justify-center">
          <Logo class="text-lg" />
        </div>
        <Card>
          <CardHeader>
            <CardTitle class="text-base">
              <h1>{setup() ? t().login.setupTitle : t().login.welcome}</h1>
            </CardTitle>
            <CardDescription>
              {setup() ? t().login.setupDescription : t().login.description}
            </CardDescription>
          </CardHeader>
          <CardContent>
          <form
            class="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate();
            }}
          >
            <div class="grid gap-2">
              <Label for="password">{t().login.password}</Label>
              <Input
                id="password"
                type="password"
                autofocus
                autocomplete={setup() ? "new-password" : "current-password"}
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                aria-invalid={submit.isError}
              />
              <Show when={setup()}>
                <p class="text-xs text-muted-foreground">{t().login.minLength}</p>
              </Show>
            </div>
            <Show when={setup()}>
              <div class="grid gap-2">
                <Label for="confirm">{t().login.confirm}</Label>
                <Input id="confirm" type="password" autocomplete="new-password" value={confirm()} onInput={(e) => setConfirm(e.currentTarget.value)} />
              </div>
            </Show>
            <Show when={submit.error}>
              <p class="text-sm text-destructive">{errorMessage(submit.error)}</p>
            </Show>
            <Button type="submit" class="mt-1 w-full" disabled={!password() || submit.isPending || auth.isPending}>
              {submit.isPending ? t().login.pending : setup() ? t().login.create : t().login.signIn}
            </Button>
          </form>
          </CardContent>
        </Card>
        <div class="mt-6 flex justify-center">
          <LanguageToggle />
        </div>
        <p class="mt-4 text-center text-xs text-muted-foreground">
          commit {(import.meta.env.VITE_GIT_COMMIT ?? "dev").slice(0, 7)}
        </p>
      </div>
    </main>
  );
}
