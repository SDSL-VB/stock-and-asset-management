"use client";

import { usePathname } from "next/navigation";
import { useLiveData } from "@/hooks/use-live-data";

/**
 * Mounts the live-refresh behaviour for the whole dashboard.
 *
 * Called by: `app/(dashboard)/layout.tsx`. Renders nothing — it exists only
 * because the layout is a server component and the hook needs to run in the
 * browser.
 *
 * Held still on the pages where a refresh would be unwelcome: anything the user
 * is part-way through filling in. Everywhere else — lists, queues, dashboards —
 * updates on its own.
 */

/** Pages that are a form someone is in the middle of. */
function isFormPage(pathname: string): boolean {
  return pathname.endsWith("/new") || pathname.endsWith("/edit");
}

export function LiveData() {
  const pathname = usePathname();
  useLiveData({ enabled: !isFormPage(pathname) });
  return null;
}
