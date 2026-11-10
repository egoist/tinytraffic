import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { isServer } from "solid-js/web";
import { AppHeader } from "~/components/app-header";
import { api } from "~/lib/api";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context, location }) => {
    if (isServer) return;
    const auth = await context.queryClient.fetchQuery({ queryKey: ["auth"], queryFn: api.auth, staleTime: 60_000 });
    if (!auth.authenticated) {
      throw redirect({ to: "/login", search: { redirect: location.href === "/" ? undefined : location.href } });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  // The live view takes the whole window.
  const fullscreen = useRouterState({ select: (s) => s.matches.some((m) => m.routeId === "/_app/sites/$siteId/live") });
  return (
    <Show
      when={!fullscreen()}
      fallback={<Outlet />}
    >
      <div class="min-h-dvh">
        <AppHeader />
        <main class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </Show>
  );
}
