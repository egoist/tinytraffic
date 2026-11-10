import { Check, Copy } from "lucide-solid";
import { createSignal } from "solid-js";
import { Button } from "./ui/button";

export function CodeBlock(props: { code: string }) {
  const [copied, setCopied] = createSignal(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(props.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }
  return (
    <div class="group relative min-w-0">
      <pre class="rounded-lg border bg-muted/50 p-4 pr-12 font-mono break-all whitespace-pre-wrap text-[12.5px] leading-relaxed">
        <code>{props.code}</code>
      </pre>
      <Button variant="ghost" size="icon-sm" class="absolute top-2 right-2" onClick={copy} aria-label="Copy">
        {copied() ? <Check class="text-positive" /> : <Copy />}
      </Button>
    </div>
  );
}

export function trackingSnippet(domain: string) {
  const origin = typeof location === "undefined" ? "https://your-tinytraffic-host" : location.origin;
  return `<script defer data-domain="${domain}" src="${origin}/js/script.js"></script>`;
}
