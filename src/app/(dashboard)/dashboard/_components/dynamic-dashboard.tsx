"use client";

import Link from "next/link";
import {
  Package,
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  IndianRupee,
  Users,
  Building2,
  Plus,
  List,
  Edit,
  Inbox,
  Tags,
  BarChart3,
  Wrench,
  TrendingUp,
} from "lucide-react";
import { StatCard } from "@/components/dashboard/stat-card";

import { DashboardHero } from "@/components/dashboard/dashboard-hero";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { Reveal, Stagger, StaggerItem } from "@/components/motion";
import { formatCurrency } from "@/lib/format";
import {
  PERMISSIONS,
  PRODUCT_MANAGE_PERMISSIONS,
  STOCK_CONFIG_PERMISSIONS,
  resolveStockScope,
} from "@/lib/rbac/permissions";
import type { Trend } from "@/lib/actions/dashboard";

/**
 * The single, permission-driven dashboard. Every section below declares the
 * permission it needs; the page only fetches (and this component only renders)
 * what the current user's role is actually allowed to see. New roles composed
 * from any mix of permissions get a sensible dashboard with zero extra code.
 */

interface RecentEntry {
  id: string;
  entryNumber: string;
  itemName: string;
  status: string;
  totalPrice: number;
  rejectionReason?: string | null;
  createdAt: Date;
  department: { name: string } | null;
  createdBy: { name: string };
}

// One item in the unified review queue: a stock entry approval or a
// transfer/product/category request, labelled by kind and linking to
// wherever it gets approved
export type ReviewQueueItem = {
  kind:
    | "STOCK_ENTRY"
    | "TRANSFER"
    | "PRODUCT"
    | "CATEGORY"
    | "SITE_REQUEST"
    | "PURCHASE_INTENT";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  amount?: number;
};

const REVIEW_KIND_META: Record<
  ReviewQueueItem["kind"],
  { label: string; badgeClass: string }
> = {
  STOCK_ENTRY: {
    label: "Stock Entry",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  TRANSFER: {
    label: "Stock Transfer Request",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
  },
  PURCHASE_INTENT: {
    label: "Purchase Need",
    badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  SITE_REQUEST: {
    label: "Site Request",
    badgeClass: "bg-teal-50 text-teal-700 border-teal-200",
  },
  PRODUCT: {
    label: "Product Request",
    badgeClass: "bg-purple-50 text-purple-700 border-purple-200",
  },
  CATEGORY: {
    label: "Category Request",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
  },
};

interface DeptOverview {
  id: string;
  name: string;
  _count: { users: number };
}

interface ActivityItem {
  id: string;
  action: string;
  entity: string;
  details: string | null;
  createdAt: Date;
  user: { name: string };
}

interface Props {
  greeting: string;
  role: string;
  permissions: string[];
  stock: {
    stats: {
      total: number;
      drafts: number;
      submitted: number;
      approved: number;
      rejected: number;
      approvedValue: number;
      recentEntries: RecentEntry[];
    };
    trends: {
      entries: Trend;
      pending: Trend;
      approved: Trend;
      approvedValue: Trend;
      users: Trend;
    };
  } | null;
  reviewQueue: ReviewQueueItem[] | null;
  /** Catalog requests waiting — reviewers see everyone's, askers see their own */
  catalogRequestCount: number | null;
  team: {
    userCount: number;
    departmentCount: number;
    recentUsers: number;
  } | null;
  departments: DeptOverview[] | null;
  activity: ActivityItem[] | null;
  dispatch: {
    awaitingAcceptance: number;
    inTransit: number;
    deliveredThisMonth: number;
  } | null;
  departmentMemberCount: number | null;
}

const statusBadgeClasses: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 border-gray-200",
  SUBMITTED: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
};

export function DynamicDashboard({
  greeting,
  role,
  permissions,
  stock,
  reviewQueue,
  catalogRequestCount,
  team,
  departments,
  activity,
  dispatch,
  departmentMemberCount,
}: Props) {
  const has = (p: string) => permissions.includes(p);
  const isAdmin = resolveStockScope({ role, permissions }) === "all";
  const canManageCatalog = PRODUCT_MANAGE_PERMISSIONS.some(has);

  const rejectedEntries =
    has(PERMISSIONS.STOCK_CREATE) && stock
      ? stock.stats.recentEntries.filter((e) => e.status === "REJECTED")
      : [];

  const pendingCatalogRequests = catalogRequestCount ?? 0;

  const reviewCount = reviewQueue?.length ?? 0;

  // The hero surfaces the single most urgent thing this user can act on.
  // Clicking it jumps straight to the one pending item, or to the combined
  // review queue when several are waiting.
  const highlight = (() => {
    if (reviewQueue && reviewCount > 0) {
      return {
        label: `${reviewCount} ${reviewCount === 1 ? "item needs" : "items need"} your review`,
        urgent: true,
        href: reviewCount === 1 ? reviewQueue[0].href : "#review-queue",
      };
    }
    if (rejectedEntries.length > 0) {
      return {
        label: `${rejectedEntries.length} ${rejectedEntries.length === 1 ? "entry needs" : "entries need"} fixing`,
        urgent: true,
        href:
          rejectedEntries.length === 1
            ? `/stock/${rejectedEntries[0].id}/edit`
            : "/stock",
      };
    }
    if (pendingCatalogRequests > 0) {
      return {
        label: `${pendingCatalogRequests} catalog ${pendingCatalogRequests === 1 ? "request" : "requests"}`,
        href: "/stock/products",
      };
    }
    if (stock && has(PERMISSIONS.STOCK_CREATE) && stock.stats.drafts > 0) {
      return {
        label: `${stock.stats.drafts} ${stock.stats.drafts === 1 ? "draft" : "drafts"} to finish`,
        href: "/stock",
      };
    }
    if (stock) return { label: "All caught up — nice work" };
    return undefined;
  })();

  // The one button offered up front. Reviewing beats creating: someone who can
  // do both is waiting on other people's work, not making more of their own.
  // const heroAction = has(PERMISSIONS.STOCK_APPROVE)
  //   ? { label: "Review stock", href: "/stock" }
  //   : has(PERMISSIONS.STOCK_CREATE)
  //     ? { label: "New stock entry", href: "/stock/new" }
  //     : has(PERMISSIONS.REPORTS_VIEW)
  //       ? { label: "Open reports", href: "/reports" }
  //       : undefined;
  const heroAction = undefined;

  // Quick actions, in priority order, filtered by permission
  const quickActions = [
    has(PERMISSIONS.STOCK_CREATE) && {
      label: "New Entry",
      description: "Record incoming stock",
      href: "/stock/new",
      icon: Plus,
      tone: "approved" as const,
    },
    (has(PERMISSIONS.STOCK_VIEW) || has(PERMISSIONS.STOCK_CREATE)) && {
      label: "Stock Entries",
      description: "Browse all entries",
      href: "/stock",
      icon: List,
      tone: "info" as const,
    },
    // Transfers live on Assets now, catalog requests on the Catalog page —
    // each queue sits with the thing it is about.
    has(PERMISSIONS.ASSETS_TRANSFER_REQUEST) ||
    has(PERMISSIONS.ASSETS_TRANSFER_APPROVE)
      ? {
          label: "Transfers",
          description: "Move stock into a department",
          href: "/assets",
          icon: Inbox,
          tone: "info" as const,
        }
      : false,
    canManageCatalog && {
      label: "Product Catalog",
      description: "Codes & categories",
      href: "/stock/products",
      icon: Tags,
      tone: "info" as const,
    },
    has(PERMISSIONS.REPORTS_VIEW) && {
      label: "Reports",
      description: "Stock analytics",
      href: "/reports",
      icon: BarChart3,
      tone: "info" as const,
    },
    has(PERMISSIONS.USERS_VIEW) && {
      label: "Team Members",
      description: "People & accounts",
      href: "/users",
      icon: Users,
      tone: "info" as const,
    },
    STOCK_CONFIG_PERMISSIONS.some(has) && {
      label: "Stock Config",
      description: "Fields, flows, uploads",
      href: "/configure",
      icon: Wrench,
      tone: "draft" as const,
    },
  ].filter(Boolean) as Array<{
    label: string;
    description: string;
    href: string;
    icon: typeof Plus;
    tone: "info" | "approved" | "pending" | "draft";
  }>;

  const hasAnything =
    stock ||
    reviewQueue ||
    team ||
    departments ||
    activity ||
    dispatch ||
    quickActions.length > 0;

  return (
    <div className="space-y-8">
      <Reveal>
        <DashboardHero
          greeting={greeting}
          description={
            isAdmin
              ? "Here's what's happening across your organisation today."
              : has(PERMISSIONS.STOCK_APPROVE)
                ? "Manage your department's stock and approvals."
                : has(PERMISSIONS.STOCK_CREATE)
                  ? "Create and manage your stock entries."
                  : "Welcome to Straight Drive SIM."
          }
          highlight={highlight}
          action={heroAction}
        />
      </Reveal>

      {/* Stock KPIs — anyone who can see or create stock */}
      {stock && (<p>STOCK REVIEW</p>)}
      {stock && (
        <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StaggerItem>
            <StatCard
              title={isAdmin ? "Stock Entries" : "My Entries"}
              value={stock.stats.total}
              description="Total entries"
              icon={Package}
              tone="info"
              trend={stock.trends.entries.series}
              deltaPct={stock.trends.entries.deltaPct}
              href="/stock"
            />
          </StaggerItem>
          {has(PERMISSIONS.STOCK_CREATE) ? (
            <StaggerItem>
              <StatCard
                title="Drafts"
                value={stock.stats.drafts}
                description="Not yet submitted"
                icon={FileText}
                tone="draft"
                href="/stock"
              />
            </StaggerItem>
          ) : null}
          <StaggerItem>
            <StatCard
              title="Pending"
              value={stock.stats.submitted}
              description={
                has(PERMISSIONS.STOCK_APPROVE)
                  ? "Awaiting your review"
                  : "Awaiting approval"
              }
              icon={Clock}
              tone="pending"
              trend={stock.trends.pending.series}
              deltaPct={stock.trends.pending.deltaPct}
              href="/stock"
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              title="Approved"
              value={stock.stats.approved}
              description="Approved entries"
              icon={CheckCircle}
              tone="approved"
              trend={stock.trends.approved.series}
              deltaPct={stock.trends.approved.deltaPct}
              href="/stock"
            />
          </StaggerItem>
          {has(PERMISSIONS.STOCK_VALUE_VIEW) && (
            <StaggerItem>
              <StatCard
                title="Approved Value"
                value={stock.stats.approvedValue}
                description="Total approved stock"
                icon={IndianRupee}
                tone="approved"
                currency
                trend={stock.trends.approvedValue.series}
                deltaPct={stock.trends.approvedValue.deltaPct}
                href={has(PERMISSIONS.REPORTS_VIEW) ? "/reports" : "/stock"}
              />
            </StaggerItem>
          )}
        </Stagger>
      )}

      {/* Team KPIs — anyone who can see users/departments */}
      {(team || departmentMemberCount !== null) && (<p>USER MANAGEMENT</p>)}
      {(team || departmentMemberCount !== null) && (
        <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {departmentMemberCount !== null && (
            <StaggerItem>
              <StatCard
                title="Department Members"
                value={departmentMemberCount}
                description="Active members"
                icon={Users}
                tone="info"
                href="/users"
              />
            </StaggerItem>
          )}
          {team && (
            <>
              <StaggerItem>
                <StatCard
                  title="Total Users"
                  value={team.userCount}
                  description="Active accounts"
                  icon={Users}
                  tone="info"
                  trend={stock?.trends.users.series}
                  deltaPct={stock?.trends.users.deltaPct}
                  href="/users"
                />
              </StaggerItem>
              {has(PERMISSIONS.DEPARTMENTS_VIEW) && (
                <StaggerItem>
                  <StatCard
                    title="Departments"
                    value={team.departmentCount}
                    description="Active departments"
                    icon={Building2}
                    tone="info"
                    href="/departments"
                  />
                </StaggerItem>
              )}
              <StaggerItem>
                <StatCard
                  title="New This Month"
                  value={team.recentUsers}
                  description="Recently added"
                  icon={TrendingUp}
                  tone="approved"
                  href="/users"
                />
              </StaggerItem>
            </>
          )}
        </Stagger>
      )}

      {/* Quick actions */}
      {/* {quickActions.length > 0 && (
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-h2">
            <Zap className="size-5 text-status-info" />
            Quick Actions
          </h2>
          <Stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {quickActions.map((action) => (
              <StaggerItem key={action.href}>
                <QuickActionCard {...action} />
              </StaggerItem>
            ))}
          </Stagger>
        </section>
      )} */}

      {/* <div>
        {reviewQueue && (
          <Card id="review-queue" className="scroll-mt-6">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Clock className="size-4 text-status-pending" />
                Needs Your Review
                {reviewQueue.length > 0 && (
                  <Badge
                    variant="outline"
                    className="bg-amber-50 text-amber-700 border-amber-200"
                  >
                    {reviewQueue.length}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {reviewQueue.length === 0 ? (
                <EmptyState
                  emoji="✅"
                  title="Nothing waiting on you"
                  description="Stock entries and requests awaiting your approval will show up here."
                  className="py-8"
                />
              ) : (
                <Stagger className="space-y-3" stagger={0.04}>
                  {reviewQueue.map((item) => {
                    const meta = REVIEW_KIND_META[item.kind];
                    return (
                      <StaggerItem key={`${item.kind}-${item.id}`}>
                        <div className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors duration-200 hover:border-status-pending/40 hover:bg-muted/60">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="truncate text-body font-semibold">
                                {item.title}
                              </p>
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${meta.badgeClass}`}
                              >
                                {meta.label}
                              </Badge>
                            </div>
                            <p className="truncate text-caption text-muted-foreground">
                              {item.subtitle}
                              {item.kind === "STOCK_ENTRY" &&
                                item.amount !== undefined &&
                                has(PERMISSIONS.STOCK_VALUE_VIEW) &&
                                ` · ${formatCurrency(item.amount)}`}
                            </p>
                          </div>
                          <Button
                            render={<Link href={item.href} />}
                            nativeButton={false}
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                          >
                            <Eye />
                            Review
                          </Button>
                        </div>
                      </StaggerItem>
                    );
                  })}
                </Stagger>
              )}
            </CardContent>
          </Card>
        )}
      </div> */}

      {dispatch && (<p>DISPATCH OVERVIEW</p>)}
      {/* Dispatch is a module in its own right — an operator holding only
          dispatch keys still lands on something useful. */}
      {dispatch && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Link
            href="/dispatch"
            className="rounded-xl border bg-card p-5 transition hover:shadow-md"
          >
            <p className="text-3xl font-semibold tabular-nums">
              {dispatch.awaitingAcceptance}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Awaiting acceptance
            </p>
          </Link>
          <Link
            href="/dispatch"
            className="rounded-xl border bg-card p-5 transition hover:shadow-md"
          >
            <p className="text-3xl font-semibold tabular-nums">
              {dispatch.inTransit}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">In transit</p>
          </Link>
          <Link
            href="/dispatch"
            className="rounded-xl border bg-card p-5 transition hover:shadow-md"
          >
            <p className="text-3xl font-semibold tabular-nums">
              {dispatch.deliveredThisMonth}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Delivered this month
            </p>
          </Link>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* Unified review queue — everything awaiting this user's approval,
            labelled by kind (stock entries, transfers, products, categories) */}

        {/* Needs fixing — creators with rejected entries */}
        {has(PERMISSIONS.STOCK_CREATE) && rejectedEntries.length > 0 && (
          <Card className="border-red-200">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <XCircle className="size-4 text-status-rejected" />
                Needs Fixing
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Stagger className="space-y-3" stagger={0.04}>
                {rejectedEntries.map((entry) => (
                  <StaggerItem key={entry.id}>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-red-100 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-body font-semibold">
                          {entry.itemName}
                        </p>
                        <p className="truncate text-caption text-muted-foreground">
                          {entry.entryNumber}
                        </p>
                        {entry.rejectionReason && (
                          <p className="mt-1 text-caption text-status-rejected">
                            Reason: {entry.rejectionReason}
                          </p>
                        )}
                      </div>
                      <Button
                        render={<Link href={`/stock/${entry.id}/edit`} />}
                        nativeButton={false}
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                      >
                        <Edit />
                        Edit &amp; Resubmit
                      </Button>
                    </div>
                  </StaggerItem>
                ))}
              </Stagger>
            </CardContent>
          </Card>
        )}

        {/* Recent entries — anyone with stock visibility */}
        {stock && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Package className="size-4 text-status-approved" />
                Recent Stock Entries
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stock.stats.recentEntries.length === 0 ? (
                <EmptyState
                  emoji="📦"
                  title="No stock entries yet"
                  description={
                    has(PERMISSIONS.STOCK_CREATE)
                      ? "Create your first entry to get started."
                      : "Entries will show up here as they're created."
                  }
                  action={
                    has(PERMISSIONS.STOCK_CREATE)
                      ? { label: "New stock entry", href: "/stock/new" }
                      : undefined
                  }
                  className="py-8"
                />
              ) : (
                <Stagger className="space-y-3" stagger={0.04}>
                  {stock.stats.recentEntries.slice(0, 5).map((entry) => (
                    <StaggerItem key={entry.id}>
                      <Link
                        href={`/stock/${entry.id}`}
                        className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors duration-200 hover:bg-muted/60"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-body font-semibold">
                            {entry.itemName}
                          </p>
                          <p className="truncate text-caption text-muted-foreground">
                            {entry.entryNumber} &middot; {entry.createdBy.name}
                            {has(PERMISSIONS.STOCK_VALUE_VIEW) &&
                              ` · ${formatCurrency(entry.totalPrice)}`}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={statusBadgeClasses[entry.status] ?? ""}
                        >
                          {entry.status}
                        </Badge>
                      </Link>
                    </StaggerItem>
                  ))}
                </Stagger>
              )}
            </CardContent>
          </Card>
        )}

        {/* Department overview — department viewers */}
        {departments && departments.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Building2 className="size-4 text-status-info" />
                Departments
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Stagger className="space-y-3" stagger={0.04}>
                {departments.slice(0, 6).map((dept) => (
                  <StaggerItem key={dept.id}>
                    <Link
                      href={`/departments/${dept.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors duration-200 hover:bg-muted/60"
                    >
                      <p className="truncate text-body font-semibold">
                        {dept.name}
                      </p>
                      <span className="flex shrink-0 items-center gap-1.5 text-caption text-muted-foreground">
                        <Users className="size-3.5" />
                        {dept._count.users}
                      </span>
                    </Link>
                  </StaggerItem>
                ))}
              </Stagger>
            </CardContent>
          </Card>
        )}

        {/* Activity feed — spans when it's the only thing in its row */}
        {activity && (
          <div className={stock ? "lg:col-span-2" : ""}>
            <RecentActivity activities={activity} searchable={isAdmin} />
          </div>
        )}
      </div>

      {/* A role with no permissions still gets a friendly landing */}
      {!hasAnything && (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              emoji="👋"
              title="Welcome aboard"
              description="Your account is active, but no modules are enabled for your role yet. Contact an administrator if you think something is missing."
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
