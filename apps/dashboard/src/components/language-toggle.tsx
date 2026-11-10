import { Languages } from "lucide-solid";
import { localePref, setLocale, t, type LocalePref } from "~/lib/i18n";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

/** Each language is named in itself, so it can be found from any language. */
const options: { value: Exclude<LocalePref, "system">; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh", label: "简体中文" },
];

export function LanguageToggle() {
  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger as={Button} variant="ghost" size="icon-sm" aria-label={t().language.label}>
        <Languages />
      </DropdownMenuTrigger>
      <DropdownMenuContent class="min-w-36">
        <DropdownMenuItem checked={localePref() === "system"} onSelect={() => setLocale("system")}>
          {t().language.system}
        </DropdownMenuItem>
        {options.map((o) => (
          <DropdownMenuItem checked={localePref() === o.value} onSelect={() => setLocale(o.value)}>
            <span lang={o.value}>{o.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
