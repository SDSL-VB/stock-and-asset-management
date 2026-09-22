/**
 * Status colour — the single source of truth.
 *
 * Every status badge in the app resolves through `statusPill()` here. That
 * matters for two reasons beyond consistency.
 *
 * **Dark mode.** The colour values live as tokens in `globals.css`, which
 * defines each one twice — once for each theme. A badge written as
 * `bg-amber-50 text-amber-800` has no dark variant, so it stays a pale amber
 * card with dark text on a dark page. Ten components were doing exactly that.
 *
 * **Contrast.** Brand green (#00E676) is a fill colour, not a text colour: it
 * measures ~1.7:1 on white and fails WCAG AA badly. `--status-approved` is a
 * darker green that passes, so approved *text* and approved *fills* are
 * deliberately different values. Hand-picked palette colours lose that.
 *
 * Five tones carry every status in the system. The point of so few is that a
 * reader learns the vocabulary once: amber is waiting on somebody, green is
 * settled, red was refused, grey is inert, blue is moving.
 *
 * This covers STATUS. Decorative tints — the module colours in the role editor,
 * the amber callout panels in the how-to guide — are not statuses and are
 * deliberately left alone.
 */

export type StatusTone =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "info";

/**
 * Every status string the app can render, mapped onto a tone.
 *
 * The keys are the values of the status enums in `schema.prisma`. Where two
 * enums share a word they share a tone on purpose: a PENDING write-off and a
 * PENDING transfer are both "somebody has to decide", and should not look like
 * two different kinds of thing.
 *
 * An unknown key falls through to `draft`, so a new enum value renders as inert
 * grey rather than throwing — but add it here, or it will read as inert
 * forever.
 */
const TONE_BY_STATUS: Record<string, StatusTone> = {
  // Waiting on a person — StockEntry, ApprovalStep, WriteOff, Request,
  // Transfer, Dispatch, PurchaseIntent, SiteRequest, Bom, Build, PurchaseOrder
  SUBMITTED: "pending",
  PENDING: "pending",
  IN_PROGRESS: "pending",
  OPEN: "pending",

  // Settled, and settled well
  APPROVED: "approved",
  PUBLISHED: "approved",
  RECEIVED: "approved",
  COMPLETED: "approved",
  ACCEPTED: "approved",
  ACTIVE: "approved",

  // Refused by somebody
  REJECTED: "rejected",

  // On the move, or otherwise mid-flight and not yet an outcome
  IN_TRANSIT: "info",
  ORDERED: "info",
  REVERSED: "info",

  // Inert: not started, withdrawn, or finished with
  DRAFT: "draft",
  CANCELLED: "draft",
  CLOSED: "draft",
  SKIPPED: "draft",
  INACTIVE: "draft",
};

type ToneStyles = {
  /** Foreground/text colour. */
  text: string;
  /** Tinted background surface. */
  bg: string;
  /** Border that matches the tone without shouting. */
  border: string;
  /** Everything needed for a pill/badge in one string. */
  pill: string;
  /** Small solid dot, for use inside a pill or beside a label. */
  dot: string;
  /** Raw CSS variable, for inline `--k` custom-property handoffs. */
  cssVar: string;
};

const STYLES: Record<StatusTone, ToneStyles> = {
  draft: {
    text: "text-status-draft",
    bg: "bg-status-draft-bg",
    border: "border-status-draft/25",
    pill: "bg-status-draft-bg text-status-draft border-status-draft/25",
    dot: "bg-status-draft",
    cssVar: "var(--status-draft)",
  },
  pending: {
    text: "text-status-pending",
    bg: "bg-status-pending-bg",
    border: "border-status-pending/25",
    pill: "bg-status-pending-bg text-status-pending border-status-pending/25",
    dot: "bg-status-pending",
    cssVar: "var(--status-pending)",
  },
  approved: {
    text: "text-status-approved",
    bg: "bg-status-approved-bg",
    border: "border-status-approved/25",
    pill: "bg-status-approved-bg text-status-approved border-status-approved/25",
    dot: "bg-status-approved",
    cssVar: "var(--status-approved)",
  },
  rejected: {
    text: "text-status-rejected",
    bg: "bg-status-rejected-bg",
    border: "border-status-rejected/25",
    pill: "bg-status-rejected-bg text-status-rejected border-status-rejected/25",
    dot: "bg-status-rejected",
    cssVar: "var(--status-rejected)",
  },
  info: {
    text: "text-status-info",
    bg: "bg-status-info-bg",
    border: "border-status-info/25",
    pill: "bg-status-info-bg text-status-info border-status-info/25",
    dot: "bg-status-info",
    cssVar: "var(--status-info)",
  },
};

/** Styles for a tone you already know. */
export function toneStyles(tone: StatusTone): ToneStyles {
  return STYLES[tone];
}

/** The tone a status string carries. Unknown statuses read as inert grey. */
function toneOf(status: string): StatusTone {
  return TONE_BY_STATUS[status] ?? "draft";
}

/**
 * Badge classes for a status — what nearly every caller wants.
 *
 *   <Badge variant="outline" className={statusPill(entry.status)}>
 *
 * Returns background, text and border together, because a pill needs all three
 * and splitting them is how they drift apart.
 */
export function statusPill(status: string): string {
  return STYLES[toneOf(status)].pill;
}

