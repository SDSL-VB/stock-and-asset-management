"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

interface HoverLiftProps {
  children: ReactNode;
  className?: string;
  /** How far the surface rises, in px. */
  lift?: number;
  /** Disable for surfaces that aren't actually clickable. */
  disabled?: boolean;
}

/**
 * The app's one hover affordance: interactive surfaces rise slightly.
 *
 * Motion handles the transform (springs read better than a CSS ease here);
 * the shadow step-up is left to CSS via the `group` class on the wrapper, so
 * we're not animating box-shadow on the main thread every frame.
 */
export function HoverLift({
  children,
  className,
  lift = 4,
  disabled = false,
}: HoverLiftProps) {
  const reduce = useReducedMotion();

  if (reduce || disabled) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      whileHover={{ y: -lift }}
      whileTap={{ y: -1 }}
      transition={{ type: "spring", stiffness: 420, damping: 30, mass: 0.7 }}
    >
      {children}
    </motion.div>
  );
}
