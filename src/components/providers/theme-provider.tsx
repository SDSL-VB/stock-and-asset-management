"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Light / dark / system theme for the whole app, via next-themes.
 *
 * next-themes writes a small inline <script> into the page that sets the theme
 * class before anything paints, so a dark-mode user never sees a white flash.
 * That script has to run from the SERVER's HTML, and it does.
 *
 * React 19 then complains ("Encountered a script tag while rendering React
 * component") when the browser builds the same element, because a script React
 * creates is never executed. The warning is true and harmless — the script had
 * already done its job — but it fills the console on every page. next-themes
 * 0.4.6 is the latest release and has no fix of its own.
 *
 * So the browser's copy is given a data type. React only warns about scripts
 * that would be JavaScript, and a data block is not one; the server's copy is
 * left untouched, so the theme still lands before first paint. next-themes marks
 * the element suppressHydrationWarning, so the two copies differing is expected.
 */
const browserScriptProps =
  typeof window === "undefined" ? undefined : { type: "application/json" };

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      scriptProps={browserScriptProps}
    >
      {children}
    </NextThemesProvider>
  );
}
