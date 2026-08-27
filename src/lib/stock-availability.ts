/**
 * How much of a stock entry is still uncommitted.
 *
 * Central stock is drawn down by four different things, and every place that
 * offers stock has to subtract all four or the same units get promised twice:
 *
 *   issues            already moved into a department (as stock or as an asset)
 *   pending transfers requested but not yet approved
 *   dispatches        sent to another location or a client and not rejected
 *   builds            consumed making something else, whether that work is
 *                     finished or still on the floor
 *
 * A rejected or cancelled dispatch releases its quantity back; one that is
 * pending, in transit, or received stays committed. A reversed build likewise
 * releases what it took.
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
export const COMMITTING_BUILD_STATUSES = ["IN_PROGRESS", "COMPLETED"] as const;

export const committingBuildConsumptionsWhere = {
  build: { status: { in: [...COMMITTING_BUILD_STATUSES] } },
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
} as const;

type Drawdowns = {
  quantity: number;
  issues: { quantity: number }[];
  transferRequests?: { quantity: number }[];
  dispatchItems?: { quantity: number }[];
  buildConsumptions?: { quantity: number }[];
};

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

  // Rounded because a build may consume a fraction (25 metres of cable), and
  // float arithmetic otherwise leaves 6.999999999 where 7 belongs.
  return round(entry.quantity - issued - dispatched - consumed);
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
  return round(heldQuantity(entry) - pending);
}

/** Four decimal places is finer than anything on a shop floor is measured to. */
export function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
