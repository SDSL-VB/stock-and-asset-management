"use client";

import { motion, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Entrance animation on route change.
 *
 * The plan called for React's <ViewTransition>, but the installed React
 * (19.2.8 stable) doesn't export it — that API only exists on the experimental
 * channel, and Next 16.3 has no config flag to opt in. Moving the whole app
 * onto experimental React to get a page fade is a bad trade, so this does the
 * same job with the motion dependency we already added.
 *
 * Keyed on pathname so each navigation replays the entrance. Entrance only —
 * an exit animation would mean holding the old page on screen while the new
 * one is ready, which makes navigation feel slower than it is.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();

  if (reduce) return <>{children}</>;

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
