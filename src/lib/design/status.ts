/**
 * Status colour — the single source of truth.
 *
 * Before this file, the same four stock-entry statuses were re-declared with
 * different colours in four separate places (stock-entry-list, stock-reports,
 * how-to-guide, user-card-grid), so DRAFT looked like one thing on the list
 * page and another on the report. Everything now reads from here, and the
 * actual colour values live as tokens in globals.css so both themes resolve
 * from one definition.
 *
 * Note the greens: brand green (#00E676) is a fill colour, not a text colour —
 * it measures ~1.7:1 on white and fails WCAG AA badly. `--status-approved` is a
 * darker green that passes, so approved *text* and approved *fills* are
 * deliberately different values.
 */

export type StatusTone =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "info";

/** Maps every status string the app uses onto one of the five tones. */
const TONE_BY_KEY: Record<string, StatusTone> = {
  // StockEntryStatus
  DRAFT: "draft",
  SUBMITTED: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  // ApprovalStepStatus
  PENDING: "pending",
  SKIPPED: "draft",
  // AssetStatus
  AVAILABLE: "approved",
  ASSIGNED: "info",
  MAINTENANCE: "pending",
  RETIRED: "draft",
  LOST: "rejected",
  // TransferStatus
  COMPLETED: "approved",
  CANCELLED: "draft",
  // Generic
  ACTIVE: "approved",
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

