import { PERMISSIONS, resolveStockScope } from "@/lib/rbac/permissions";

/**
 * Who may decide what someone raised.
 *
 * The rule everywhere is RAISE WHAT YOU MAY APPROVE, AND IT IS APPROVED: a
 * stock entry, write-off, asset transfer, site request, need or BOM raised by
 * someone who could approve it is approved on raising, with them recorded as
 * the approver. The functions below say who "could approve it" for each flow,
 * so the approve action, the queues and the raise-time check share one answer.
 *
 * Two exceptions, decided with the owner:
 *   - Dispatch keeps a second person: a consignment is raised, acknowledged by
 *     the receiving site, then marked received. SELF_APPROVAL_REFUSAL is its.
 *   - Write-offs are decided by the Stock Manager role (writeOffDecisionRefusal);
 *     one it raises itself is approved on raising like everything else.
 *
 * Confirming DELIVERY is outside all of this — receiving goods you asked for is
 * the normal case, not a self-approval.
 */
export const SELF_APPROVAL_REFUSAL =
  "You raised this, so it is not yours to answer. Someone else has to review it.";

/**
 * Why this person may not act on this entry, or null if they may.
 *
 * Authority is `stock.approve` — a permission, never a role name — or, for an
 * entry tagged for service, `stock.service.approve` instead. What narrows it is
 * WHERE the goods are:
 *
 *   department  an entry already in a department is that department's business
 *   site        central stock belongs to the site it arrived at
 *
 * The site rule is the one that was missing. Central stock has no department,
 * so the department check passed by default and any approver anywhere could
 * sign off another city's goods.
 */
export function approvalRefusal(
  entry: { departmentId: string | null; locationId: string | null; forService: boolean; source?: string },
  user: { departmentId?: string | null; locationId?: string | null; role: string; permissions: string[] }
): string | null {
  // Built goods are approved by the Production Manager on the Builds page
  if (entry.source === "BUILT") {
    return "Built goods are approved on the Builds page, by whoever approves built goods";
  }
  // Service stock has its own approvers, and ordinary approvers never see it
  if (entry.forService) {
    if (!user.permissions.includes(PERMISSIONS.STOCK_SERVICE_APPROVE)) return "Stock entry not found";
  } else if (!user.permissions.includes(PERMISSIONS.STOCK_APPROVE)) {
    return "You do not have permission to approve stock entries";
  }

  // Seeing every site means being able to approve at every site
  if (resolveStockScope(user) === "all") return null;

  if (entry.departmentId !== null && entry.departmentId !== user.departmentId) {
    return "That entry belongs to another department";
  }

  // An entry with no location predates locations, so nobody is shut out of it
  if (entry.locationId !== null && entry.locationId !== user.locationId) {
    return "Those goods arrived at another site, so someone there has to approve them";
  }

  return null;
}

/**
 * Why this person may not decide this write-off, or null if they may.
 *
 * Authority is `stock.writeoff.approve` — `stock.service.approve` for service
 * stock — narrowed by scope: every site; their own site (the Stock Manager);
 * or, for someone scoped to a department, that department's losses and their
 * own site's central stock. The same rule decides whether a write-off someone
 * raises is approved on raising.
 */
export function writeOffDecisionRefusal(
  user: { role: string; departmentId?: string | null; locationId?: string | null; permissions: string[] },
  writeOff: {
    forService: boolean;
    departmentId: string | null;
    /** The site the loss is at: the department's, or the central entry's */
    siteId: string | null;
  }
): string | null {
  const key = writeOff.forService
    ? PERMISSIONS.STOCK_SERVICE_APPROVE
    : PERMISSIONS.STOCK_WRITEOFF_APPROVE;
  if (!user.permissions.includes(key)) return "That write-off does not exist";

  const scope = resolveStockScope(user);
  if (scope === "all") return null;

  const atOwnSite = writeOff.siteId !== null && writeOff.siteId === user.locationId;
  if (scope === "location") {
    return atOwnSite ? null : "That write-off is at another site";
  }
  // Department (or narrower): their own department's losses, and central stock
  // at their own site
  if (writeOff.departmentId) {
    return writeOff.departmentId === user.departmentId
      ? null
      : "You can only decide write-offs in your own department";
  }
  return atOwnSite ? null : "That write-off is at another site";
}

/**
 * Why this person may not decide this transfer into a department, or null if
 * they may. Authority is `assets.transfer.approve`, narrowed by scope: every
 * site; the receiving department's site (the Stock Manager); or, for someone
 * scoped to a department, transfers into that department. The same rule
 * decides whether a transfer someone asks for is approved on asking.
 */
export function transferDecisionRefusal(
  user: { role: string; departmentId?: string | null; locationId?: string | null; permissions: string[] },
  transfer: { departmentId: string; siteId: string | null }
): string | null {
  if (!user.permissions.includes(PERMISSIONS.ASSETS_TRANSFER_APPROVE)) {
    return "You do not have permission to decide transfers";
  }
  const scope = resolveStockScope(user);
  if (scope === "all") return null;
  if (scope === "location") {
    return transfer.siteId !== null && transfer.siteId === user.locationId
      ? null
      : "That transfer is into a department at another site";
  }
  return transfer.departmentId === user.departmentId
    ? null
    : "You can only decide transfers into your own department";
}

/**
 * Step 1 of a transfer: why this person may not agree it for the receiving
 * department, or null if they may. `assets.transfer.department`, for their own
 * department (every department if they see every site).
 */
export function transferDepartmentRefusal(
  user: { role: string; departmentId?: string | null; locationId?: string | null; permissions: string[] },
  transfer: { departmentId: string }
): string | null {
  if (!user.permissions.includes(PERMISSIONS.ASSETS_TRANSFER_DEPARTMENT)) {
    return "You do not have permission to agree requests for a department";
  }
  if (resolveStockScope(user) === "all") return null;
  return transfer.departmentId === user.departmentId
    ? null
    : "Only the receiving department's manager can agree it";
}

/** Transfers waiting on this person's department step, as a database filter. */
export function transferDepartmentWhere(user: {
  role: string;
  departmentId?: string | null;
  locationId?: string | null;
  permissions: string[];
}): Record<string, unknown> {
  if (!user.permissions.includes(PERMISSIONS.ASSETS_TRANSFER_DEPARTMENT)) return { id: NO_MATCH };
  if (resolveStockScope(user) === "all") return {};
  return { departmentId: user.departmentId ?? NO_MATCH };
}

/** The transfers this person may decide, as a database filter (see above). */
export function transferDecidableWhere(user: {
  role: string;
  departmentId?: string | null;
  locationId?: string | null;
  permissions: string[];
}): Record<string, unknown> {
  if (!user.permissions.includes(PERMISSIONS.ASSETS_TRANSFER_APPROVE)) return { id: NO_MATCH };
  const scope = resolveStockScope(user);
  if (scope === "all") return {};
  if (scope === "location") return { department: { locationId: user.locationId ?? NO_MATCH } };
  return { departmentId: user.departmentId ?? NO_MATCH };
}

/** Matches no row: a filter on it returns nothing, where leaving it out returned everything */
const NO_MATCH = "__no_match__";

/**
 * Why this person may not approve finished units from a build, or null if they
 * may. Authority is `bom.build.approve` (the Production Manager), at the site
 * the run is on unless they see every site. The same rule decides whether
 * units someone finishes are approved at once.
 */
export function builtGoodsRefusal(
  user: { role: string; locationId?: string | null; permissions: string[] },
  build: { locationId: string }
): string | null {
  if (!user.permissions.includes(PERMISSIONS.BOM_BUILD_APPROVE)) {
    return "You do not have permission to approve built goods";
  }
  if (resolveStockScope(user) === "all") return null;
  return build.locationId === user.locationId ? null : "That run is at another site";
}

/**
 * Material requests — a department asking central stock for materials.
 *
 *   step 1  the department's manager approves (materials.approve.department,
 *           their own department unless they see every site)
 *   step 2  the Stock Manager supplies (materials.supply, at their own site)
 *
 * Each step the requester could take is taken on raising; one person holding
 * both approves once.
 */
export function materialDepartmentRefusal(
  user: { role: string; departmentId?: string | null; permissions: string[] },
  request: { departmentId: string }
): string | null {
  if (!user.permissions.includes(PERMISSIONS.MATERIALS_APPROVE_DEPARTMENT)) {
    return "You do not have permission to approve material requests";
  }
  if (resolveStockScope(user) === "all") return null;
  return request.departmentId === user.departmentId
    ? null
    : "Only that department's manager approves its requests";
}

export function materialSupplyRefusal(
  user: { role: string; locationId?: string | null; permissions: string[] },
  request: { locationId: string }
): string | null {
  if (!user.permissions.includes(PERMISSIONS.MATERIALS_SUPPLY)) {
    return "You do not have permission to supply material requests";
  }
  if (resolveStockScope(user) === "all") return null;
  return request.locationId === user.locationId ? null : "That request is at another site";
}

/** The material requests someone may see, as a database filter. */
export function materialRequestsVisibleWhere(user: {
  id: string;
  role: string;
  departmentId?: string | null;
  locationId?: string | null;
  permissions: string[];
}): Record<string, unknown> {
  const all = resolveStockScope(user) === "all";
  const approves = user.permissions.includes(PERMISSIONS.MATERIALS_APPROVE_DEPARTMENT);
  const supplies = user.permissions.includes(PERMISSIONS.MATERIALS_SUPPLY);
  if (all && (approves || supplies)) return {};
  const or: Record<string, unknown>[] = [{ requestedById: user.id }];
  if (approves && user.departmentId) or.push({ departmentId: user.departmentId });
  if (supplies && user.locationId) or.push({ locationId: user.locationId });
  return { OR: or };
}
