/**
 * Shared formatters: money, dates, relative time, and initials.
 *
 * Every screen that prints a rupee figure reads one of the three money
 * functions below. They differ only in how they treat paise, and picking the
 * wrong one is the mistake worth avoiding:
 *
 *   formatCurrency   no paise      — totals and holdings (₹51,000)
 *   formatMoney      always paise  — line amounts that must tally to an
 *                                    invoice (₹1,250.00)
 *   formatUnitPrice  paise if any  — a single unit's price (₹350, ₹44.50)
 *
 * Keeping them here rather than inline is not tidiness. An inline formatter is
 * invisible to whoever changes the rule, so the copies drift: before this file
 * was made the definitive one, six components each carried their own and the
 * same figure printed three different ways across the app.
 */

/** Totals: paise on a ₹51,000 holding are noise. */
const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatCurrency(amount: number): string {
  return INR.format(amount);
}

/**
 * A figure that has to tally, shown to the paise whether or not it has any.
 *
 * Order lines, entry totals and anything a person will add up against a
 * supplier's invoice. ₹1,250 printed next to ₹1,249.50 reads as a discrepancy;
 * ₹1,250.00 does not.
 */
const INR_EXACT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(amount: number): string {
  return INR_EXACT.format(amount);
}

/**
 * A unit price, which unlike a total needs its paise — but only real ones.
 *
 * `formatCurrency` drops decimals, which is right for a ₹51,000 holding and
 * wrong for a ₹44.50 metre of cable: rounded to ₹45 it stops matching the
 * invoice. Paise are shown only when there are any, so a price list of whole
 * rupees stays readable instead of becoming a column of ₹350.00.
 */
export function formatUnitPrice(amount: number): string {
  return Number.isInteger(amount) ? INR.format(amount) : INR_EXACT.format(amount);
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IST_OFFSET_MS = 5.5 * 3_600_000;

/**
 * "18 Sep 2026, 14:32" in India time — a moment someone may need to act on,
 * such as when stock went low. Built by hand rather than with toLocaleString,
 * whose month names differ between Node and browsers ("Sep" / "Sept") and
 * would make the server's and the browser's copy of a page disagree.
 */
export function formatDateTime(date: Date | string): string {
  const d = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
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
