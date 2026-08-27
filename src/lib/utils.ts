import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * The one class-name helper, used by every component.
 *
 * `cn()` merges Tailwind classes so a later class wins over an earlier one —
 * which is what lets a component take a `className` prop that actually
 * overrides its own styling rather than fighting it.
 */

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
