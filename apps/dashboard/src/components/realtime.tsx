import { useQuery } from "@tanstack/solid-query";
import { api } from "~/lib/api";
import { formatNumber } from "~/lib/format";
import { t } from "~/lib/i18n";
import { ready } from "~/lib/query";

export function Realtime(props: { site: string }) {
  const q = useQuery(() => ({
    queryKey: ["realtime", props.site],
    queryFn: () => api.realtime(props.site),
    refetchInterval: 15_000,
  }));
  const n = () => ready(q)?.visitors ?? 0;
  return (
    <span class="inline-flex items-center gap-2 text-sm text-muted-foreground" title={t().realtime.title}>
      <span class="relative flex size-2">
        <span class="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-60" />
        <span class="relative inline-flex size-2 rounded-full bg-live" />
      </span>
      <span>
        <span class="font-medium text-foreground tabular">{formatNumber(n())}</span> {t().realtime.current(n())}
      </span>
    </span>
  );
}
