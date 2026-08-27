"use client";

import type { Session } from "next-auth";
import { SessionProvider } from "./session-provider";
import { ThemeProvider } from "./theme-provider";
import { ToastProvider } from "./toast-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({
  children,
  session,
}: {
  children: React.ReactNode;
  session?: Session | null;
}) {
  return (
    <SessionProvider session={session}>
      <ThemeProvider>
        <TooltipProvider>
          {children}
          <ToastProvider />
        </TooltipProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
