/**
 * Shared formatters.
 *
 * `timeAgo` was previously copy-pasted into recent-activity.tsx and
 * super-admin-dashboard.tsx, and the INR formatter was re-created inline in
 * three more places. One definition means they can't drift apart.
 */

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const COMPACT_INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCurrency(amount: number): string {
  return INR.format(amount);
}

export function timeAgo(date: Date | string): string {
  const then = new Date(date).getTime();
  const diff = Date.now() - then;

  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;

  return new Date(date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "JD" from "Jane Doe" — used by every avatar fallback in the app. */
export function initialsOf(name: string | null | undefined): string {
  if (!name) return "U";
  return (
    name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "U"
  );
}
