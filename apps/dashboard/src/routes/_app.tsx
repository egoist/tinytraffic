import { createFileRoute, Outlet, useRouterState } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { AppHeader } from "~/components/app-header";
import { authQuery } from "~/lib/auth";

export const Route = createFileRoute("/_app")({
  // Known before the first render, so pages don't change shape once it loads.
  loader: ({ context }) => context.queryClient.ensureQueryData(authQuery),
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
