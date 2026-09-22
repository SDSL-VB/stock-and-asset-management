/**
 * How much of a stock entry is still uncommitted.
 *
 * Central stock is drawn down by five different things, and every place that
 * offers stock has to subtract all five or the same units get promised twice:
 *
 *   issues            already moved into a department (as stock or as an asset)
 *   pending transfers requested but not yet approved
 *   dispatches        sent to another location or a client and not rejected
 *   builds            consumed making something else, whether that work is
 *                     finished or still on the floor
 *   write-offs        damaged, lost, expired — stock that stopped being stock
 *
 * A rejected or cancelled dispatch releases its quantity back; one that is
 * pending, in transit, or received stays committed. A reversed build likewise
 * releases what it took, and so does a rejected or reversed write-off.
 *
 * Keeping this in one function is what makes the stock list, dispatch, assets,
 * requests and reports agree without any of them knowing about the others.
 */

export const COMMITTING_DISPATCH_STATUSES = [
  "PENDING",
  "IN_TRANSIT",
  "RECEIVED",
] as const;

/** Prisma `where` fragment selecting only dispatch items that hold stock. */
export const committingDispatchItemsWhere = {
  dispatch: { status: { in: [...COMMITTING_DISPATCH_STATUSES] } },
};

/**
 * Build consumptions that still hold stock.
 *
 * Components leave the shelf when work *starts*, not when it finishes — a run
 * sitting on the floor has already eaten them. So a build in progress commits
 * its components exactly as a completed one does; only a reversed build gives
 * them back.
 */
const COMMITTING_BUILD_STATUSES = ["IN_PROGRESS", "COMPLETED"] as const;

export const committingBuildConsumptionsWhere = {
  build: { status: { in: [...COMMITTING_BUILD_STATUSES] } },
};

/**
 * Write-offs that still hold, or still freeze, stock.
 *
 * Both live states are fetched together because they mean different things and
 * both are needed:
 *
 *   APPROVED  a manager signed it off. The goods are gone — subtracted from
 *             what is HELD.
 *   PENDING   raised, not yet answered. The goods are still on the shelf, so
 *             they stay HELD, but nobody may promise them away — subtracted
 *             from what is AVAILABLE. This is exactly how a pending transfer
 *             request already behaves.
 *
 * REJECTED and REVERSED write-offs release their quantity and so appear in
 * neither figure.
 *
 * `stockIssueId: null` is the important half of this filter. A write-off
 * raised against a DEPARTMENT'S holding must never be subtracted from the
 * entry, because the issue it belongs to was already taken off the entry when
 * the stock moved. Counting it here as well would deduct every departmental
 * loss twice. Those write-offs are handled by heldByIssue() instead.
 */
const LIVE_WRITE_OFF_STATUSES = ["PENDING", "APPROVED"] as const;

export const centralWriteOffsWhere = {
  stockIssueId: null,
  status: { in: [...LIVE_WRITE_OFF_STATUSES] },
};

/**
 * The Prisma `include` that fetches exactly what availableQuantity() needs.
 *
 * Use this rather than listing the four relations by hand. Seven places did
 * that, and one of them left out the dispatch and build relations — which is
 * how a transfer could be approved for stock already loaded on a consignment.
 * Selecting through this constant makes the query and the sum impossible to
 * disagree about.
 */
export const availabilityInclude = {
  issues: { select: { quantity: true } },
  transferRequests: {
    where: { status: "PENDING" as const },
    select: { quantity: true },
  },
  dispatchItems: { where: committingDispatchItemsWhere, select: { quantity: true } },
  buildConsumptions: {
    where: committingBuildConsumptionsWhere,
    select: { quantity: true },
  },
  writeOffs: { where: centralWriteOffsWhere, select: { quantity: true, status: true } },
} as const;

/** One live write-off, as the two functions below need to see it. */
type WriteOffDrawdown = { quantity: number; status: string };

type Drawdowns = {
  quantity: number;
  issues: { quantity: number }[];
  transferRequests?: { quantity: number }[];
  dispatchItems?: { quantity: number }[];
  buildConsumptions?: { quantity: number }[];
  writeOffs?: WriteOffDrawdown[];
};

/** How much of a list of write-offs is in one state. */
function sumWriteOffs(writeOffs: WriteOffDrawdown[] | undefined, status: string): number {
  return (writeOffs ?? [])
    .filter((w) => w.status === status)
    .reduce((sum, w) => sum + w.quantity, 0);
}

/**
 * How much is physically standing where this entry says it is.
 *
 * Everything that has actually MOVED is gone: issued into a department, loaded
 * onto a consignment, eaten by a build. A pending transfer request is not
 * subtracted, because nothing has moved yet — somebody has only asked.
 *
 * This is the number for any screen answering "what is here": the stock list,
 * the entry page, the holdings reports. Showing the raw `quantity` instead is
 * what let one PC be counted at the site it left and the site it arrived at
 * simultaneously.
 */
export function heldQuantity(entry: Drawdowns): number {
  const issued = entry.issues.reduce((sum, i) => sum + i.quantity, 0);
  const dispatched = (entry.dispatchItems ?? []).reduce((sum, d) => sum + d.quantity, 0);
  const consumed = (entry.buildConsumptions ?? []).reduce((sum, c) => sum + c.quantity, 0);
  // Only APPROVED write-offs. A pending one is still physically on the shelf,
  // and reporting it as gone before a manager has agreed would make the stock
  // figure disagree with what a stock count finds.
  const writtenOff = sumWriteOffs(entry.writeOffs, "APPROVED");

  // Rounded because a build may consume a fraction (25 metres of cable), and
  // float arithmetic otherwise leaves 6.999999999 where 7 belongs.
  return round(entry.quantity - issued - dispatched - consumed - writtenOff);
}

/**
 * How much can still be PROMISED to somebody: what is here, less what has
 * already been asked for and not yet answered.
 *
 * This is the number for anything that hands stock out — the dispatch picker,
 * the fulfilment plan, the transfer and move checks. It is never larger than
 * `heldQuantity`, and the difference is exactly the pending requests.
 */
export function availableQuantity(entry: Drawdowns): number {
  const pending = (entry.transferRequests ?? []).reduce((sum, r) => sum + r.quantity, 0);
  // A write-off waiting on a manager freezes its quantity the same way an
  // unanswered transfer request does. Without this, five bearings could be
  // marked damaged on Monday, loaded onto a consignment on Tuesday, and
  // Wednesday's approval would remove stock that had already left the site.
  const pendingWriteOffs = sumWriteOffs(entry.writeOffs, "PENDING");
  return round(heldQuantity(entry) - pending - pendingWriteOffs);
}

/**
 * The department side of the same question.
 *
 * A department's holding is its StockIssue, and a write-off raised against
 * that holding reduces it — but must NOT reduce the entry as well, because the
 * whole issued quantity was already taken off the entry when the stock moved.
 * That is why these two functions exist separately from the four above:
 * `availabilityInclude` deliberately ignores departmental write-offs, and this
 * is where they are accounted for instead.
 *
 * Use `issueWriteOffsInclude` to fetch exactly what these need.
 */
const liveWriteOffsWhere = {
  status: { in: [...LIVE_WRITE_OFF_STATUSES] },
};

export const issueWriteOffsInclude = {
  writeOffs: { where: liveWriteOffsWhere, select: { quantity: true, status: true } },
};

/**
 * The same thing, spread into a `select` on an entry's `issues` relation:
 *
 *   issues: { select: { departmentId: true, quantity: true, ...issueWriteOffsSelect } }
 *
 * The reports compute each department's share from these issues, so without it
 * a department would go on being credited with stock it has written off.
 */
export const issueWriteOffsSelect = issueWriteOffsInclude;

type IssueDrawdowns = {
  quantity: number;
  writeOffs?: WriteOffDrawdown[];
};

/** What the department still physically has: issued, less what was written off. */
export function heldByIssue(issue: IssueDrawdowns): number {
  return round(issue.quantity - sumWriteOffs(issue.writeOffs, "APPROVED"));
}

/**
 * What a department could still write off or hand back — what it holds, less
 * anything already awaiting a manager's decision. Stops the same damaged units
 * being reported twice while the first report is still pending.
 */
export function availableFromIssue(issue: IssueDrawdowns): number {
  return round(heldByIssue(issue) - sumWriteOffs(issue.writeOffs, "PENDING"));
}

/** Four decimal places is finer than anything on a shop floor is measured to. */
export function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
