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
 */

export type ScopedUser = {
  id: string;
  departmentId?: string | null;
  /** Inherited from the user's department; null for admins */
  locationId?: string | null;
  /** True when the user's department is their location's central stock */
  inCentralStock?: boolean;
};

export type ScopedEntry = {
  status: string;
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

export function visibleToLocationScope(entry: ScopedEntry, user: ScopedUser): boolean {
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
export function departmentScopeCandidatesWhere(departmentId: string | null | undefined) {
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
export function locationScopeCandidatesWhere(
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
