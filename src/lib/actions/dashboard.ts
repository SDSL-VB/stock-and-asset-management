"use server";

import { prisma } from "@/lib/prisma";
import { requireAnyPermission, requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS, resolveStockScope } from "@/lib/rbac/permissions";
import { stockCandidatesWhere, isStockVisible } from "@/lib/stock-visibility";
import {
  heldQuantity,
  committingDispatchItemsWhere,
  committingBuildConsumptionsWhere,
} from "@/lib/stock-availability";
import { getActivityLogs } from "./activity";

/**
 * Everything the dashboard shows.
 *
 * Called by: `src/app/(dashboard)/dashboard/page.tsx` only.
 *
 * Two rules run through this file, and both were broken before:
 *
 *   Every function checks a permission. These are server actions, so anyone
 *   signed in can call them directly — what the page chooses to render is not
 *   a security boundary.
 *
 *   Every function resolves the caller's scope itself. The page used to work
 *   out the scope and pass ids down, and it had no branch for `location`, so a
 *   site-bound person's tiles silently counted the whole company.
 */

/**
 * The caller, in the shape the scope helpers expect.
 *
 * `resolveStockScope` reads the permissions, `stockCandidatesWhere` and
 * `isStockVisible` read the department and site.
 */
type Viewer = {
  id: string;
  role: string;
  permissions: string[];
  departmentId?: string | null;
  locationId?: string | null;
};

/**
 * Every field the visibility rule needs, whatever the caller is showing.
 *
 * Selected on every query below, because `isStockVisible` cannot answer without
 * them — a query that forgets one silently returns rows nobody should see.
 */
const VISIBILITY_SELECT = {
  status: true,
  quantity: true,
  departmentId: true,
  locationId: true,
  createdById: true,
  issues: { select: { departmentId: true, quantity: true } },
} as const;

/** Headcount and departments, for the team card. */
export async function getDashboardStats() {
  await requirePermission(PERMISSIONS.USERS_VIEW);

  const [userCount, departmentCount, recentUsers] = await Promise.all([
    prisma.user.count({ where: { isActive: true, isSystem: false } }),
    prisma.department.count({ where: { isActive: true } }),
    prisma.user.count({
      where: {
        isSystem: false,
        createdAt: { gte: new Date(new Date().setDate(new Date().getDate() - 30)) },
      },
    }),
  ]);

  return { userCount, departmentCount, recentUsers };
}

export async function getDepartmentOverview() {
  await requirePermission(PERMISSIONS.DEPARTMENTS_VIEW);

  return prisma.department.findMany({
    where: { isActive: true },
    include: {
      _count: { select: { users: true } },
      users: {
        take: 5,
        select: { id: true, name: true, avatar: true },
        where: { isActive: true, isSystem: false },
      },
    },
    orderBy: { name: "asc" },
  });
}

/** Stock counts and the five most recent entries, within the caller's scope. */
export async function getStockDashboardStats() {
  const user: Viewer = await requireAnyPermission([
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.STOCK_CREATE,
  ]);
  const scope = resolveStockScope(user);

  const rows = await prisma.stockEntry.findMany({
    where: stockCandidatesWhere(user, scope),
    select: {
      ...VISIBILITY_SELECT,
      id: true,
      entryNumber: true,
      itemName: true,
      totalPrice: true,
      unitPrice: true,
      createdAt: true,
      department: { select: { name: true } },
      createdBy: { select: { name: true } },
      // What has left each entry, so the value tile counts what is still held
      dispatchItems: { where: committingDispatchItemsWhere, select: { quantity: true } },
      buildConsumptions: { where: committingBuildConsumptionsWhere, select: { quantity: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const visible = rows.filter((row) => isStockVisible(row, user, scope));
  const withStatus = (status: string) => visible.filter((e) => e.status === status);

  return {
    total: visible.length,
    drafts: withStatus("DRAFT").length,
    submitted: withStatus("SUBMITTED").length,
    approved: withStatus("APPROVED").length,
    rejected: withStatus("REJECTED").length,
    recentEntries: visible.slice(0, 5),
    // The value of what is STILL HERE. Summing totalPrice counted goods that
    // had already been dispatched away or consumed by a build.
    approvedValue: withStatus("APPROVED").reduce(
      (sum, e) => sum + heldQuantity(e) * e.unitPrice,
      0
    ),
  };
}

/**
 * Entries waiting on this person.
 *
 * Authority is stock.approve plus the same where-it-arrived rules the approve
 * action enforces, so the queue never offers something that would be refused.
 * It used to match the approver's ROLE against the step, which is why the queue
 * was empty for everyone once the role named on the step had no members.
 */
export async function getPendingApprovals() {
  const user: Viewer = await requirePermission(PERMISSIONS.STOCK_APPROVE);
  const scope = resolveStockScope(user);

  const rows = await prisma.stockEntry.findMany({
    where: { status: "SUBMITTED", ...stockCandidatesWhere(user, scope) },
    select: {
      ...VISIBILITY_SELECT,
      id: true,
      entryNumber: true,
      itemName: true,
      totalPrice: true,
      createdAt: true,
      department: { select: { name: true } },
      createdBy: { select: { name: true } },
      _count: { select: { attachments: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const seesEverySite = scope === "all";

  return rows
    .filter((row) => isStockVisible(row, user, scope))
    .filter((entry) => {
      if (seesEverySite) return true;
      // An entry already in a department is that department's business;
      // central stock belongs to the site it arrived at.
      if (entry.departmentId !== null) return entry.departmentId === user.departmentId;
      return entry.locationId === null || entry.locationId === user.locationId;
    })
    .slice(0, 10);
}

/* ------------------------------------------------------------------------
   Trend data for the KPI tiles.

   Buckets the last 14 days by createdAt in JS rather than with a SQL date
   function, which keeps it portable and needs one query instead of one per day.

   Worth knowing: entries are bucketed by CREATION date and filtered by their
   CURRENT status, because a StockEntry does not record when its status changed.
   So "approved" means "created that day, approved as of now" — a fair shape for
   a week, not an audit trail.
   ------------------------------------------------------------------------ */

const TREND_DAYS = 7;

export type Trend = {
  /** One bucket per day, oldest first, TREND_DAYS long. */
  series: number[];
  /** Percent change against the preceding window. Null when there is no baseline. */
  deltaPct: number | null;
};

function windowStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (TREND_DAYS * 2 - 1));
  return d;
}

/** Bucket 0..(TREND_DAYS*2-1), oldest first. -1 when outside the window. */
function bucketIndex(date: Date, start: Date): number {
  const ms = new Date(date).getTime() - start.getTime();
  if (ms < 0) return -1;
  const index = Math.floor(ms / 86_400_000);
  return index < TREND_DAYS * 2 ? index : -1;
}

function toTrend(buckets: number[]): Trend {
  const previous = buckets.slice(0, TREND_DAYS).reduce((a, b) => a + b, 0);
  const current = buckets.slice(TREND_DAYS);
  const currentSum = current.reduce((a, b) => a + b, 0);

  return {
    series: current,
    deltaPct:
      previous === 0 ? null : Math.round(((currentSum - previous) / previous) * 1000) / 10,
  };
}

export async function getDashboardTrends(): Promise<{
  entries: Trend;
  pending: Trend;
  approved: Trend;
  approvedValue: Trend;
  users: Trend;
}> {
  const user: Viewer = await requireAnyPermission([
    PERMISSIONS.STOCK_VIEW,
    PERMISSIONS.STOCK_CREATE,
  ]);
  const scope = resolveStockScope(user);

  const start = windowStart();
  const size = TREND_DAYS * 2;

  const [candidates, userRows] = await Promise.all([
    prisma.stockEntry.findMany({
      where: { createdAt: { gte: start }, ...stockCandidatesWhere(user, scope) },
      select: { ...VISIBILITY_SELECT, totalPrice: true, createdAt: true },
    }),
    // Headcount is only charted for someone who can see the team at all
    user.permissions.includes(PERMISSIONS.USERS_VIEW)
      ? prisma.user.findMany({
          where: { createdAt: { gte: start }, isActive: true, isSystem: false },
          select: { createdAt: true },
        })
      : Promise.resolve([]),
  ]);

  const stockRows = candidates.filter((row) => isStockVisible(row, user, scope));

  const entries = new Array<number>(size).fill(0);
  const pending = new Array<number>(size).fill(0);
  const approved = new Array<number>(size).fill(0);
  const approvedValue = new Array<number>(size).fill(0);
  const users = new Array<number>(size).fill(0);

  for (const row of stockRows) {
    const i = bucketIndex(row.createdAt, start);
    if (i < 0) continue;
    entries[i] += 1;
    if (row.status === "SUBMITTED") pending[i] += 1;
    if (row.status === "APPROVED") {
      approved[i] += 1;
      approvedValue[i] += row.totalPrice ?? 0;
    }
  }

  for (const row of userRows) {
    const i = bucketIndex(row.createdAt, start);
    if (i >= 0) users[i] += 1;
  }

  return {
    entries: toTrend(entries),
    pending: toTrend(pending),
    approved: toTrend(approved),
    approvedValue: toTrend(approvedValue),
    users: toTrend(users),
  };
}

/**
 * The search box on the dashboard's recent-activity card.
 *
 * Gated and scoped through getActivityLogs rather than querying the log
 * directly — it used to be an ungated query, so anyone signed in could read
 * every activity line by calling it.
 */
export async function getSearchableActivity(query?: string) {
  await requirePermission(PERMISSIONS.ACTIVITY_VIEW);

  const { logs } = await getActivityLogs({ limit: 20, search: query });
  return logs;
}
