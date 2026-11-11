// tinytraffic tracker: pageviews (including SPA navigation), outbound link
// clicks and custom events. No cookies, no storage, no fingerprinting.
//
//   <script defer data-domain="example.com" src="https://stats.example.com/js/script.js"></script>
//
// Attributes: data-domain (defaults to the current hostname), data-api
// (event endpoint, defaults to the script's origin), data-hash (count
// #/routes as pages), data-outbound="false" (don't track outbound links).

type Props = Record<string, string | number | boolean>;
type Options = { props?: Props; callback?: () => void };
type Track = ((name: string, options?: Options) => void) & { q?: IArguments[] };

declare global {
  interface Window {
    tinytraffic?: Track;
    plausible?: Track;
    _phantom?: unknown;
    __nightmare?: unknown;
    Cypress?: unknown;
    __tinytrafficLoaded?: boolean;
  }
}

(() => {
  const w = window;

  // SPA routers (TanStack Start, Astro view transitions, ...) may re-insert
  // the script tag on navigation, which executes it again. Keep the first
  // instance: it already watches history, and a second pair of listeners
  // would send a duplicate pageview for every navigation after this one.
  if (w.__tinytrafficLoaded) return;
  w.__tinytrafficLoaded = true;

  const doc = document;
  const loc = location;
  const script = doc.currentScript as HTMLScriptElement | null;
  const attr = (name: string) => script?.getAttribute(name);

  const domain = attr("data-domain") || loc.hostname.replace(/^www\./, "");
  const endpoint = attr("data-api") || new URL("/api/event", script?.src || loc.href).href;
  const hashMode = script?.hasAttribute("data-hash") ?? false;
  const outbound = attr("data-outbound") !== "false";

  function ignored() {
    if (/^localhost$|^127(\.\d+){3}$|^\[::1\]$/.test(loc.hostname) || loc.protocol === "file:") return true;
    if (w._phantom || w.__nightmare || navigator.webdriver || w.Cypress) return true;
    try {
      if (localStorage.getItem("tinytraffic_ignore") === "true") return true;
    } catch {}
    return false;
  }

  const track: Track = (name, options) => {
    if (ignored()) {
      options?.callback?.();
      return;
    }
    const body = JSON.stringify({
      n: name,
      u: loc.href,
      d: domain,
      r: doc.referrer || null,
      t: doc.title,
      w: w.innerWidth,
      h: hashMode ? 1 : 0,
      p: options?.props,
    });
    // text/plain keeps this a "simple" request: no CORS preflight.
    // keepalive lets it finish even if the page is being unloaded.
    fetch(endpoint, { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } })
      .catch(() => {})
      .finally(() => options?.callback?.());
  };

  let lastPage: string | undefined;
  function pageview() {
    const page = loc.pathname + (hashMode ? loc.hash : "");
    if (page === lastPage) return;
    lastPage = page;
    track("pageview");
  }

  // Replay calls queued before the script loaded.
  const queued = w.tinytraffic?.q ?? [];
  w.tinytraffic = track;
  w.plausible ??= track;
  for (const args of queued) track(args[0], args[1]);

  const { history } = w;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      original.apply(this, args);
      pageview();
    };
  }
  w.addEventListener("popstate", pageview);
  if (hashMode) w.addEventListener("hashchange", pageview);

  if (outbound) {
    const onClick = (e: MouseEvent) => {
      if (e.type === "auxclick" && e.button !== 1) return;
      const link = (e.target as Element | null)?.closest?.("a");
      if (!link || !link.href) return;
      let url: URL;
      try {
        url = new URL(link.href);
      } catch {
        return;
      }
      if (!/^https?:$/.test(url.protocol) || url.host === loc.host) return;
      track("Outbound Link: Click", { props: { url: url.href } });
    };
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("auxclick", onClick, true);
  }

  // Prerendered pages count once they're actually shown.
  if ((doc as Document & { prerendering?: boolean }).prerendering || doc.visibilityState === ("prerender" as DocumentVisibilityState)) {
    doc.addEventListener("prerenderingchange", pageview, { once: true });
    doc.addEventListener("visibilitychange", function onVisible() {
      if (doc.visibilityState === "visible") {
        doc.removeEventListener("visibilitychange", onVisible);
        pageview();
      }
    });
  } else {
    pageview();
  }
})();

export {};
