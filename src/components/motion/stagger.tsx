"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

const EASE = [0.22, 1, 0.36, 1] as const;

interface StaggerProps {
  children: ReactNode;
  className?: string;
  /** Seconds between each child. 0.06 reads as "sequenced", not "slow". */
  stagger?: number;
  /** Seconds before the first child moves. */
  delay?: number;
}

/**
 * Sequences its <StaggerItem> children so a grid or list resolves in reading
 * order instead of appearing all at once. Pair with StaggerItem — a plain
 * child will render but won't animate.
 */
export function Stagger({
  children,
  className,
  stagger = 0.06,
  delay = 0,
}: StaggerProps) {
  const reduce = useReducedMotion();

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: {
          transition: { staggerChildren: stagger, delayChildren: delay },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

interface StaggerItemProps {
  children: ReactNode;
  className?: string;
  y?: number;
}

export function StaggerItem({ children, className, y = 10 }: StaggerItemProps) {
  const reduce = useReducedMotion();

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.24, ease: EASE },
        },
      }}
    >
      {children}
    </motion.div>
  );
}
