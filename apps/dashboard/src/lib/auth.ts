import { useQuery } from "@tanstack/solid-query";
import { api } from "./api";
import { ready } from "./query";

export const authQuery = { queryKey: ["auth"], queryFn: api.auth, staleTime: Infinity };

/**
 * Whether the viewer is signed in, or undefined until known. Signed-out
 * viewers only reach the dashboard of a public site.
 */
export function useSignedIn() {
  const auth = useQuery(() => authQuery);
  return () => ready(auth)?.authenticated;
}
