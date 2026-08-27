"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface CountUpProps {
  value: number;
  /** Render as INR currency (the app formats money with en-IN elsewhere). */
  currency?: boolean;
  /** Decimal places to hold steady while counting. */
  decimals?: number;
  duration?: number;
  className?: string;
}

const plain = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/**
 * Animates a number up from zero on mount.
 *
 * The final value is what renders on the server, so the correct figure is in
 * the HTML before JS runs and is what a screen reader announces — the count is
 * decoration layered on top, and it writes straight to the DOM node rather than
 * through state so a 900ms animation doesn't trigger ~54 React re-renders.
 */
export function CountUp({
  value,
  currency = false,
  decimals = 0,
  duration = 0.9,
  className,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();

  const format = (n: number) => {
    if (currency) return money.format(n);
    if (decimals > 0) {
      return n.toLocaleString("en-IN", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    }
    return plain.format(Math.round(n));
  };

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const final = format(value);

    if (reduce) {
      node.textContent = final;
      return;
    }

    const controls = animate(0, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        node.textContent = format(latest);
      },
      onComplete: () => {
        node.textContent = final;
      },
    });

    return () => controls.stop();
    // `format` is derived from the primitives below, so they cover it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, currency, decimals, duration, reduce]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {format(value)}
    </span>
  );
}
