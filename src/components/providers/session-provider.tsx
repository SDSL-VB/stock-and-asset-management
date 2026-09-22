"use client";

import type { Session } from "next-auth";
import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";

export function SessionProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  session?: Session | null;
}) {
  /*
    `refetchInterval` is in SECONDS, and it was 60 — so every open tab asked
    /api/auth/session once a minute, and each of those runs NextAuth's `jwt`
    callback, which re-reads the user's whole role and permission graph. Against
    a database 220ms away that was a second of work a minute, per tab, for data
    almost nothing on the client reads.

    Five minutes, because the poll is the weakest of the three ways a permission
    change reaches somebody. Window focus (below) covers coming back to the tab,
    and the server re-reads on its own every 30 seconds during any render, which
    is what every actual permission CHECK goes through. Nothing is decided from
    the client session — it dresses the topbar.
  */
  return (
    <NextAuthSessionProvider
      session={session ?? undefined}
      refetchOnWindowFocus={true}
      refetchInterval={300}
    >
      {children}
    </NextAuthSessionProvider>
  );
}
