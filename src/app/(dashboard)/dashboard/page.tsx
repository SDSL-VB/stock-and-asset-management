import { requireAuth, resolveStockScope } from "@/lib/rbac/check";
import {
  getDashboardStats,
  getDashboardTrends,
  getDepartmentOverview,
  getStockDashboardStats,
  getPendingApprovals,
} from "@/lib/actions/dashboard";
import { getReviewableTransfers } from "@/lib/actions/assets";
import {
  getReviewableCatalogRequests,
  getPendingRequestCount,
} from "@/lib/actions/products";
import { getActivityLogs } from "@/lib/actions/activity";
import { getDispatchDashboardCounts } from "@/lib/actions/dispatch";
import { getReviewableSiteRequests } from "@/lib/actions/fulfilment";
import { getReviewableIntents } from "@/lib/actions/procurement";
import { DISPATCH_PERMISSIONS } from "@/lib/rbac/permissions";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { prisma } from "@/lib/prisma";
import { DynamicDashboard, type ReviewQueueItem } from "./_components/dynamic-dashboard";

/**
 * One dashboard for every role. Data is fetched per PERMISSION, not per role
 * name, so custom roles automatically get the sections they're entitled to.
 * Role names only influence data *scope* (operators → own entries,
 * managers → their department), mirroring the scoping in the server actions.
 */
export default async function DashboardPage() {
  const user = await requireAuth();
  const has = (p: string) => user.permissions.includes(p);

  const canSeeStock = has(PERMISSIONS.STOCK_VIEW) || has(PERMISSIONS.STOCK_CREATE);
  const canApprove = has(PERMISSIONS.STOCK_APPROVE);
  // Each request type is reviewed on the page that owns the thing asked for:
  // transfers on Assets, products and categories on the Catalog.
  const canReviewTransfers = has(PERMISSIONS.ASSETS_TRANSFER_APPROVE);
  const canReviewCatalog =
    has(PERMISSIONS.PRODUCTS_REQUEST_APPROVE) ||
    has(PERMISSIONS.CATEGORIES_REQUEST_APPROVE);
  const canAskForCatalog =
    has(PERMISSIONS.PRODUCTS_REQUEST_CREATE) ||
    has(PERMISSIONS.CATEGORIES_REQUEST_CREATE);
  const canSeeUsers = has(PERMISSIONS.USERS_VIEW);
  const canSeeDepartments = has(PERMISSIONS.DEPARTMENTS_VIEW);
  const canSeeActivity = has(PERMISSIONS.ACTIVITY_VIEW);
  const canSeeDispatch = DISPATCH_PERMISSIONS.some((p) => has(p));
  const canAnswerSiteRequests = has(PERMISSIONS.FULFILMENT_APPROVE);
  const canVerifyIntents = has(PERMISSIONS.PROCUREMENT_INTENT_APPROVE);

  // Every action below resolves the caller's own scope. The page used to work
  // it out and pass ids down, and had no branch for site-scoped people — so
  // their tiles counted the whole company.
  const stockScope = resolveStockScope(user);

  const [
    stockStats,
    trends,
    pendingApprovals,
    reviewableTransfers,
    reviewableCatalog,
    catalogRequestCount,
    teamStats,
    departments,
    activityResult,
    departmentMemberCount,
    dispatchCounts,
    siteRequests,
    purchaseIntents,
  ] = await Promise.all([
    canSeeStock ? getStockDashboardStats() : null,
    canSeeStock ? getDashboardTrends() : null,
    canApprove ? getPendingApprovals() : null,
    canReviewTransfers ? getReviewableTransfers() : null,
    canReviewCatalog ? getReviewableCatalogRequests() : null,
    canReviewCatalog || canAskForCatalog ? getPendingRequestCount() : null,
    canSeeUsers ? getDashboardStats() : null,
    canSeeDepartments ? getDepartmentOverview() : null,
    canSeeActivity ? getActivityLogs({ limit: 8 }) : null,
    stockScope === "department" && user.departmentId
      ? prisma.user.count({
          where: { departmentId: user.departmentId, isActive: true },
        })
      : null,
    canSeeDispatch ? getDispatchDashboardCounts() : null,
    canAnswerSiteRequests ? getReviewableSiteRequests() : null,
    canVerifyIntents ? getReviewableIntents() : null,
  ]);

  // One unified review queue: stock entry approvals + every request type the
  // user can approve, each labelled by kind and linking to where it's actioned
  const reviewQueue: ReviewQueueItem[] | null =
    canApprove ||
    canReviewTransfers ||
    canReviewCatalog ||
    canAnswerSiteRequests ||
    canVerifyIntents
      ? [
          ...(pendingApprovals ?? []).map((entry) => ({
            kind: "STOCK_ENTRY" as const,
            id: entry.id,
            title: entry.itemName,
            subtitle: `${entry.entryNumber} · ${entry.createdBy.name}`,
            href: `/stock/${entry.id}`,
            amount: entry.totalPrice,
          })),
          ...(reviewableTransfers ?? []),
          ...(reviewableCatalog ?? []),
          ...(siteRequests ?? []),
          ...(purchaseIntents ?? []),
        ]
      : null;

  return (
    <DynamicDashboard
      greeting={getGreeting(user.name ?? "User")}
      role={user.role}
      permissions={user.permissions}
      stock={
        stockStats && trends ? { stats: stockStats, trends } : null
      }
      reviewQueue={reviewQueue}
      catalogRequestCount={catalogRequestCount}
      team={
        teamStats
          ? {
              userCount: teamStats.userCount,
              departmentCount: teamStats.departmentCount,
              recentUsers: teamStats.recentUsers,
            }
          : null
      }
      departments={departments}
      activity={activityResult?.logs ?? null}
      dispatch={dispatchCounts}
      departmentMemberCount={departmentMemberCount}
    />
  );
}

function getGreeting(name: string): string {
  const hour = new Date().getHours();
  const firstName = name.split(" ")[0];

  // The wave is the one bit of emoji in the persistent UI. A greeting is a
  // human moment; everything structural uses lucide icons instead. The
  // character before it is U+00A0 (non-breaking space), not a plain space,
  // so the wave can't orphan onto its own line on a narrow screen.
  if (hour < 12) return `Good morning, ${firstName} 👋`;
  if (hour < 18) return `Good afternoon, ${firstName} 👋`;
  return `Good evening, ${firstName} 👋`;
}
