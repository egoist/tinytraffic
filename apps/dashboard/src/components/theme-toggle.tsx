import { Monitor, Moon, Sun } from "lucide-solid";
import { Match, Switch } from "solid-js";
import { setTheme, theme } from "~/lib/theme";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

export function ThemeToggle() {
  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger as={Button} variant="ghost" size="icon-sm" aria-label="Theme">
        <Switch fallback={<Monitor />}>
          <Match when={theme() === "light"}>
            <Sun />
          </Match>
          <Match when={theme() === "dark"}>
            <Moon />
          </Match>
        </Switch>
      </DropdownMenuTrigger>
      <DropdownMenuContent class="min-w-36">
        <DropdownMenuItem checked={theme() === "light"} onSelect={() => setTheme("light")}>
          <Sun /> Light
        </DropdownMenuItem>
        <DropdownMenuItem checked={theme() === "dark"} onSelect={() => setTheme("dark")}>
          <Moon /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem checked={theme() === "system"} onSelect={() => setTheme("system")}>
          <Monitor /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
