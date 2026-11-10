import { createFileRoute, Outlet, redirect } from "@tanstack/solid-router";
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
  return (
    <div class="min-h-dvh">
      <AppHeader />
      <main class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}
