import { QueryCache, QueryClient } from "@tanstack/solid-query";
import { createRouter } from "@tanstack/solid-router";
import { ApiError } from "./lib/api";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const queryClient = new QueryClient({
    // A session that expired mid-use sends you back to the sign-in page.
    queryCache: new QueryCache({
      onError: (err) => {
        if (err instanceof ApiError && err.status === 401 && location.pathname !== "/login") {
          location.href = `/login?redirect=${encodeURIComponent(location.pathname + location.search)}`;
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      },
    },
  });
  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });
}

declare module "@tanstack/solid-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
