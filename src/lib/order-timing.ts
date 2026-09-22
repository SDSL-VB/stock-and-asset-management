/**
 * Is an order line arriving when the vendor said it would?
 *
 * Each purchase order line carries a lead time (days the vendor promised) and
 * the date that makes it due (`expectedBy` = order date + lead time). This
 * compares what has actually been delivered against it:
 *
 *   waiting    not fully arrived, due date still ahead   "Due in 4 days"
 *   overdue    not fully arrived, due date passed        "Overdue by 3 days"
 *   on-time    fully arrived on or before the due date   "On time"
 *   late       fully arrived after the due date          "Late by 2 days"
 *   no-date    no lead time was given for the line
 *
 * A line counts as arrived on the day the delivery that completed it was
 * booked in — the same moment it starts counting as delivered against the order
 * (src/lib/procurement-delivery.ts).
 *
 * `suggestedLeadTime` answers "does this vendor's recorded lead time need
 * updating?": when a completed line took clearly longer than the lead time on
 * record for that product from that vendor — at least 2 days and 20% longer —
 * it proposes the days it actually took. Faster deliveries propose nothing; one
 * quick delivery is luck, and a shorter lead time only brings alerts later.
 */

const DAY_MS = 86_400_000;

/** Whole calendar days from a to b (negative when b is earlier). */
function daysBetween(a: Date, b: Date): number {
  const start = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const end = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((end - start) / DAY_MS);
}

export function dueDate(orderedAt: Date, leadTimeDays: number): Date {
  return new Date(orderedAt.getTime() + leadTimeDays * DAY_MS);
}

type LineTiming = {
  state: "waiting" | "overdue" | "on-time" | "late" | "no-date";
  /** Days late / overdue / until due; 0 when on time */
  days: number;
  label: string;
  /** When the delivery that completed the line was booked in */
  arrivedAt: Date | null;
  /** Days from ordering to complete arrival */
  tookDays: number | null;
};

export function lineTiming(
  line: {
    quantity: number;
    expectedBy: Date | null;
    orderedAt: Date;
    deliveries: { quantity: number; at: Date }[];
  },
  now = new Date()
): LineTiming {
  // The delivery that brought the running total up to what was ordered
  let running = 0;
  let arrivedAt: Date | null = null;
  for (const d of [...line.deliveries].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    running += d.quantity;
    if (running >= line.quantity) {
      arrivedAt = d.at;
      break;
    }
  }
  const tookDays = arrivedAt ? daysBetween(line.orderedAt, arrivedAt) : null;
  const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

  if (!line.expectedBy) return { state: "no-date", days: 0, label: "No due date", arrivedAt, tookDays };

  if (arrivedAt) {
    const late = daysBetween(line.expectedBy, arrivedAt);
    return late > 0
      ? { state: "late", days: late, label: `Late by ${plural(late)}`, arrivedAt, tookDays }
      : { state: "on-time", days: 0, label: "On time", arrivedAt, tookDays };
  }

  const left = daysBetween(now, line.expectedBy);
  return left < 0
    ? { state: "overdue", days: -left, label: `Overdue by ${plural(-left)}`, arrivedAt, tookDays }
    : { state: "waiting", days: left, label: left === 0 ? "Due today" : `Due in ${plural(left)}`, arrivedAt, tookDays };
}

/** The lead time to propose, or null when the recorded one still holds. */
export function suggestedLeadTime(recordedDays: number | null, tookDays: number | null): number | null {
  if (recordedDays === null || tookDays === null) return null;
  const slack = Math.max(2, Math.ceil(recordedDays * 0.2));
  return tookDays >= recordedDays + slack ? tookDays : null;
}
