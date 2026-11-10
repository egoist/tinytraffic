/**
 * The query's data, or undefined until it has loaded.
 *
 * Always use this instead of reading `query.data` directly: in Solid Query,
 * reading `data` before the first result arrives suspends the nearest
 * <Suspense> boundary — the router's, around the whole page — which makes
 * the page blink.
 */
export function ready<T>(query: { isSuccess: boolean; data: T | undefined }): T | undefined {
  return query.isSuccess ? query.data : undefined;
}
