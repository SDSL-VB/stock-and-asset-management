"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /** Seconds to wait before starting. Use to sequence sibling blocks. */
  delay?: number;
  /** Distance in px the element rises from. Keep it small — this is a nudge. */
  y?: number;
  className?: string;
  /** Animate when scrolled into view rather than immediately on mount. */
  onView?: boolean;
}

/**
 * Fade + rise on entrance.
 *
 * This is a client component, but `children` is rendered by whichever
 * component passes it in — so a Server Component can wrap server-rendered
 * markup in <Reveal> without that markup becoming client-side.
 */
export function Reveal({
  children,
  delay = 0,
  y = 8,
  className,
  onView = false,
}: RevealProps) {
  const reduce = useReducedMotion();

  if (reduce) return <div className={className}>{children}</div>;

  const animation = {
    initial: { opacity: 0, y },
    transition: {
      duration: 0.24,
      delay,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  };

  if (onView) {
    return (
      <motion.div
        className={className}
        initial={animation.initial}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={animation.transition}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      className={className}
      initial={animation.initial}
      animate={{ opacity: 1, y: 0 }}
      transition={animation.transition}
    >
      {children}
    </motion.div>
  );
}
