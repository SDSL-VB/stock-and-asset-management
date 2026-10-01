/**
 * The single source of truth for what a location- or department-scoped user may
 * see. Used by the stock list/detail/stats, dashboard, and reports so the rule
 * can never drift between surfaces.
 *
 * A user's location comes from their department; a user with no department
 * (Super Admin, Admin) has no location and is never narrowed by one.
 *
 * `location` scope — Central Stock Manager, Dispatch Operator:
 *   every department's stock plus central stock, within their own location.
 *
 * `department` scope — Department Manager:
 *   their own department's stock, plus the actionable central stock of their
 *   location (awaiting approval, or approved and not yet fully moved), so they
 *   can see what is available to pull in.
 *
 * Both always see their own entries. Entries created before locations existed
 * have no location and are treated as belonging to every location, so nothing
 * silently disappears from view.
 *
 * ENTRY-ONLY — anyone who may enter stock but does not hold `stock.view`:
 *   only their OWN entries, and only while those are still in their hands — a
 *   draft they are writing, or one sent back to them to correct. Once submitted
 *   it leaves their view; once approved it never returns. This overrides the
 *   scope ladder above: an entry operator's job is to enter stock, not to read
 *   it. Give `stock.view` back and the ordinary scope applies again — it is a
 *   permission, so it is set on the role, not here.
 *
 * SERVICE STOCK — entries tagged `forService`, goods received for service:
 *   held apart from central stock, and seen only by holders of
 *   `stock.service.view`. `stock.view` never reaches them, and
 *   `stock.service.view` reaches nothing else. Someone holding both sees both.
 *   The scope ladder above still decides WHICH site's service stock. The author
 *   keeps their own draft or sent-back entry either way, like an entry operator.
 *
 * APPROVERS — `stock.approve` (or `stock.service.approve` for service stock):
 *   see entries WAITING for approval within their scope, even without
 *   stock.view, and lose them once decided. That is how a Stock Manager reaches
 *   its approval queue without being able to browse every entry.
 */

type ScopedUser = {
  id: string;
  departmentId?: string | null;
  /** Inherited from the user's department; null for admins */
  locationId?: string | null;
  /** True when the user's department is their location's central stock */
  inCentralStock?: boolean;
  /**
   * What they may do. Read for one thing only: whether they may look at stock
   * entries at all (`stock.view`). Missing is read as "no" — fail closed, so a
   * caller that forgets to pass it sees less, never more.
   */
  permissions?: string[];
};

/** The statuses an entry-only person still sees: the work in their hands. */
const ENTRY_ONLY_STATUSES = ["DRAFT", "REJECTED"];

/**
 * May this person see the money on this entry — unit price, total, value?
 *
 * Prices belong to whoever holds `stock.value.view` (accounts, admin). The one
 * exception is the price somebody TYPED: an entry's author sees the money on it
 * while it is still in their hands — a draft, or one sent back to correct —
 * because they are reading it off the invoice and may be asked to fix it. Once
 * submitted it is out of their hands and the ordinary rule applies.
 *
 * The same test decides whether a save may change the price: a price someone
 * cannot see is a price they cannot overwrite, or a masked ₹0 would be saved
 * over the real one.
 */
export function maySeeEntryMoney(
  entry: { createdById: string; status: string },
  user: { id: string; permissions?: string[] }
): boolean {
  if (user.permissions?.includes("stock.value.view")) return true;
  // An approver deciding an entry sees its price — while it waits, not after
  if (user.permissions?.includes("stock.value.approving") && entry.status === "SUBMITTED") {
    return true;
  }
  return entry.createdById === user.id && ENTRY_ONLY_STATUSES.includes(entry.status);
}

/**
 * May this person see service stock — goods received for service?
 *
 * The string rather than the constant, for the same reason as below.
 */
export function seesServiceStock(user: { permissions?: string[] }): boolean {
  return user.permissions?.includes("stock.service.view") ?? false;
}

/**
 * Why stock at one site may not go into this department, or null if it may.
 * A department at another site — or either side with no site on record — needs
 * `assets.move.crosssite`. Strict on a missing site on purpose: "unknown" must
 * never count as "the same".
 */
export function crossSiteRefusal(
  entry: { locationId: string | null },
  department: { locationId: string | null },
  user: { permissions?: string[] }
): string | null {
  if (entry.locationId !== null && entry.locationId === department.locationId) return null;
  if (user.permissions?.includes("assets.move.crosssite")) return null;
  return "That department is at another site — only someone allowed to move stock between sites can do this";
}

/** May they approve ordinary stock entries? */
function approvesStock(user: { permissions?: string[] }): boolean {
  return user.permissions?.includes("stock.approve") ?? false;
}

/** May they approve service stock entries? */
function approvesServiceStock(user: { permissions?: string[] }): boolean {
  return user.permissions?.includes("stock.service.approve") ?? false;
}

/**
 * Which kind of stock someone may pick from — to dispatch, to write off — as a
 * where-fragment: ordinary stock, service stock, or both.
 */
export function stockKindWhere(user: { permissions?: string[] }): { forService?: boolean } {
  const service = seesServiceStock(user);
  if (!service) return { forService: false };
  return seesStockEntries(user) ? {} : { forService: true };
}

/**
 * May this person look at stock entries, or only enter them?
 *
 * The string rather than PERMISSIONS.STOCK_VIEW so this file keeps no import
 * from the permission table — it is read by client components too.
 */
export function seesStockEntries(user: { permissions?: string[] }): boolean {
  return user.permissions?.includes("stock.view") ?? false;
}

type ScopedEntry = {
  status: string;
  /** Required, so a query that forgets to select it fails to compile */
  forService: boolean;
  /** "BUILT" entries waiting are the Production Manager's, not a stock approver's */
  source?: string;
  quantity: number;
  departmentId: string | null;
  locationId: string | null;
  createdById: string;
  issues: { departmentId: string; quantity: number }[];
};

/** Central stock that is still worth acting on: pending, or approved with quantity left. */
function isActionableCentralStock(entry: ScopedEntry): boolean {
  if (entry.departmentId !== null) return false;
  if (entry.status === "SUBMITTED") return true;
  const issued = entry.issues.reduce((sum, i) => sum + i.quantity, 0);
  return entry.status === "APPROVED" && entry.quantity - issued > 0;
}

/** An entry with no location predates locations and is visible from anywhere. */
function sameLocation(entry: ScopedEntry, user: ScopedUser): boolean {
  if (entry.locationId === null) return true;
  if (!user.locationId) return false;
  return entry.locationId === user.locationId;
}

function visibleToLocationScope(entry: ScopedEntry, user: ScopedUser): boolean {
  if (entry.createdById === user.id) return true;
  return sameLocation(entry, user);
}

export function visibleToDepartmentScope(entry: ScopedEntry, user: ScopedUser): boolean {
  // Own entries are always visible to their creator
  if (entry.createdById === user.id) return true;

  // A user sitting in a central stock department is scoped to their whole
  // location, not to the "department" of central stock itself.
  if (user.inCentralStock) return sameLocation(entry, user);

  if (user.departmentId) {
    // Department manager: their department's stock…
    if (entry.departmentId !== null) return entry.departmentId === user.departmentId;
    if (entry.issues.some((i) => i.departmentId === user.departmentId)) return true;
    // …plus the central stock of their own location, so they can request it
    return sameLocation(entry, user) && isActionableCentralStock(entry);
  }

  // No department and no central-stock flag: legacy central stock manager
  return isActionableCentralStock(entry);
}

/**
 * Prisma where-fragment that over-approximates department-scope visibility;
 * ALWAYS post-filter the fetched rows with visibleToDepartmentScope.
 */
function departmentScopeCandidatesWhere(departmentId: string | null | undefined) {
  return {
    OR: [
      { departmentId: null },
      ...(departmentId
        ? [{ departmentId }, { issues: { some: { departmentId } } }]
        : []),
    ],
  };
}

/**
 * Prisma where-fragment for location scope. Entries with no location are
 * included so pre-location data stays reachable; ALWAYS post-filter with
 * visibleToLocationScope.
 */
function locationScopeCandidatesWhere(
  locationId: string | null | undefined,
  userId: string
) {
  if (!locationId) return {};
  return {
    OR: [{ locationId }, { locationId: null }, { createdById: userId }],
  };
}

/* ------------------------------------------------------------------------- */
/* The two functions everything else should use                              */
/* ------------------------------------------------------------------------- */

/**
 * The database filter for someone's stock scope.
 *
 * Deliberately over-approximate — SQL cannot express "central stock at my site
 * that still has quantity left", so this narrows as far as a query can and
 * `isStockVisible` finishes the job in memory. Use BOTH, always.
 *
 * Six places used to hand-write this ladder, and one of them forgot the
 * location clause, which is how a Bengaluru engineer could see Hyderabad's
 * central stock. There is now one copy.
 */
export function stockCandidatesWhere(
  user: ScopedUser,
  scope: "all" | "location" | "department" | "own"
): Record<string, unknown> {
  // Wrapped in AND so that a caller combining this with its own status — say
  // `{ status: "APPROVED", ...this }` — gets nothing rather than having its
  // status silently replaced by ours.
  const inHand = { createdById: user.id, status: { in: ENTRY_ONLY_STATUSES } };
  const ordinary = seesStockEntries(user);
  const service = seesServiceStock(user);

  // What kinds of entry they may see: all ordinary or all service entries, or
  // only those waiting for an approval they can give
  const kinds: Record<string, unknown>[] = [];
  if (ordinary) kinds.push({ forService: false });
  else if (approvesStock(user)) {
    // Built goods waiting are approved on the Builds page, not here
    kinds.push({ forService: false, status: "SUBMITTED", source: { not: "BUILT" } });
  }
  if (service) kinds.push({ forService: true });
  else if (approvesServiceStock(user)) kinds.push({ forService: true, status: "SUBMITTED" });
  if (kinds.length === 0) {
    return { AND: [inHand] };
  }

  // Then narrowed by scope. Empty conditions are left out, not nested: Prisma
  // reads `{}` inside an OR as matching nothing, which once hid everything from
  // an admin.
  const conditions = [
    ordinary && service ? {} : kinds.length === 1 ? kinds[0] : { OR: kinds },
    scopeCandidatesWhere(user, scope),
  ].filter((c) => Object.keys(c).length > 0);
  if (conditions.length === 0) return {};
  return { AND: [{ OR: [inHand, { AND: conditions }] }] };
}

function scopeCandidatesWhere(
  user: ScopedUser,
  scope: "all" | "location" | "department" | "own"
): Record<string, unknown> {
  switch (scope) {
    case "all":
      return {};
    case "own":
      return { createdById: user.id };
    case "department":
      return departmentScopeCandidatesWhere(user.departmentId);
    case "location":
      return locationScopeCandidatesWhere(user.locationId, user.id);
  }
}

/** Whether one entry is really visible. Run over the rows the query returned. */
export function isStockVisible(
  entry: ScopedEntry,
  user: ScopedUser,
  scope: "all" | "location" | "department" | "own"
): boolean {
  // Their own draft or sent-back entry, whatever else they may see
  if (entry.createdById === user.id && ENTRY_ONLY_STATUSES.includes(entry.status)) {
    return true;
  }
  // Service stock needs stock.service.view; everything else needs stock.view —
  // or, for an entry waiting for approval, the matching approve key
  const waiting = entry.status === "SUBMITTED";
  const kindAllowed = entry.forService
    ? seesServiceStock(user) || (waiting && approvesServiceStock(user))
    : seesStockEntries(user) || (waiting && approvesStock(user) && entry.source !== "BUILT");
  if (!kindAllowed) return false;
  switch (scope) {
    case "all":
      return true;
    case "own":
      return entry.createdById === user.id;
    case "department":
      return visibleToDepartmentScope(entry, user);
    case "location":
      return visibleToLocationScope(entry, user);
  }
}

/**
 * The stock report's filter for a department-scoped person: their department's
 * stock — entries issued to it or legacy-assigned to it — plus the central
 * stock of THEIR OWN site, never another site's. No department on record
 * matches nothing rather than everything.
 */
export function reportDepartmentWhere(user: {
  departmentId?: string | null;
  locationId?: string | null;
}): Record<string, unknown> {
  const departmentId = user.departmentId;
  if (!departmentId) return { id: NO_SITE };
  return {
    OR: [
      { departmentId },
      { departmentId: null, locationId: user.locationId ?? NO_SITE },
      { issues: { some: { departmentId } } },
    ],
  };
}

/**
 * Matches no site. Used where someone limited to their own site has no site on
 * record: a filter on it returns nothing, where leaving the filter out would
 * have returned every site.
 */
export const NO_SITE = "__no_site__";
