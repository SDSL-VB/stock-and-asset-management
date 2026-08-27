"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a page current without anybody pressing reload.
 *
 * Used by: the dashboard layout, so every page inherits it.
 *
 * What this actually does: every page in this system is rendered on the server
 * on each request, so there is no stale cache to bust — the data is simply not
 * re-fetched once a page is open. `router.refresh()` asks the server to render
 * it again and swaps in the new result, keeping scroll position and React state
 * (open dialogs, half-typed inputs) exactly as they were. It is the same call
 * the action buttons already make after a save; this just also makes it happen
 * when somebody ELSE changes something.
 *
 * Two triggers, deliberately:
 *
 *   coming back to the tab   the common case — you switch away, someone
 *                            approves an entry, you switch back
 *   a slow interval          for a screen left open on a wall or a second
 *                            monitor
 *
 * The interval only runs while the tab is visible, so a forgotten background
 * tab costs nothing.
 */

/** Long enough to be cheap, short enough that nobody reaches for F5. */
const DEFAULT_INTERVAL_MS = 30_000;

export function useLiveData(options?: {
  /** Milliseconds between refreshes while the tab is visible */
  intervalMs?: number;
  /**
   * Set false to hold everything still — pass this while a form is dirty or a
   * dialog is mid-edit. A refresh will not wipe typed input, but it can move
   * rows under a cursor, and that is worse than data a minute old.
   */
  enabled?: boolean;
}) {
  const router = useRouter();
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const enabled = options?.enabled ?? true;

  // Held in a ref so changing `enabled` never restarts the timer mid-cycle.
  // Written in an effect rather than during render, which React forbids.
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    function refreshIfSensible() {
      if (!enabledRef.current) return;
      if (document.visibilityState !== "visible") return;
      router.refresh();
    }

    const timer = setInterval(refreshIfSensible, intervalMs);
    // Fires on both leaving and returning; the visibility check above means
    // only the return does any work.
    document.addEventListener("visibilitychange", refreshIfSensible);
    window.addEventListener("focus", refreshIfSensible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfSensible);
      window.removeEventListener("focus", refreshIfSensible);
    };
  }, [router, intervalMs]);
}
