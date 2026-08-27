"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Light/dark switch.
 *
 * The app has shipped a complete dark palette in globals.css since the start
 * but nothing ever called setTheme, so half the design system was unreachable.
 * This is the control that turns it on.
 *
 * The icon swap is done with `dark:` classes rather than by reading the theme
 * in render, so there's no hydration mismatch and no mounted-guard flicker —
 * the server and the first client render emit identical markup either way.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label="Toggle light or dark theme"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          />
        }
      >
        <Sun className="size-4 rotate-0 scale-100 transition-transform duration-300 ease-out-quart dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute size-4 rotate-90 scale-0 transition-transform duration-300 ease-out-quart dark:rotate-0 dark:scale-100" />
      </TooltipTrigger>
      <TooltipContent>Toggle theme</TooltipContent>
    </Tooltip>
  );
}
