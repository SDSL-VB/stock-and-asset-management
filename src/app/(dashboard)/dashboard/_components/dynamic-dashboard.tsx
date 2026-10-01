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
  Edit,
  TrendingUp,
  Truck,
  PackageCheck,
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
import { statusPill } from "@/lib/design/status";
import {
  PERMISSIONS,
  resolveStockScope,
} from "@/lib/rbac/permissions";
import type { Trend } from "@/lib/actions/dashboard";
import type { ReactNode } from "react";

/**
 * The single, permission-driven dashboard. Every section below declares the
 * permission it needs; the page only fetches (and this component only renders)
 * what the current user's role is actually allowed to see. New roles composed
 * from any mix of permissions get a sensible dashboard with zero extra code.
 *
 * The layout is built from whatever survives those checks, so nothing leaves
 * a hole: the KPI tiles (stock, team, dispatch) flow in one band and stretch
 * to fill each row, and the panels pair up two to a row, with a lone or
 * leftover panel taking the full width.
 */

/** A KPI tile grows to share its row; below ~200px it wraps to the next one. */
const TILE = "min-w-[200px] flex-1";

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
    | "PURCHASE_INTENT"
    | "BUILT_GOODS"
    | "MATERIALS";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  amount?: number;
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

  const rejectedEntries =
    has(PERMISSIONS.STOCK_CREATE) && stock
      ? stock.stats.recentEntries.filter((e) => e.status === "REJECTED")
      : [];

  const pendingCatalogRequests = catalogRequestCount ?? 0;

  const reviewCount = reviewQueue?.length ?? 0;

  // The hero surfaces the single most urgent thing this user can act on.
  // Clicking it jumps straight to the one pending item, or — when several are
  // waiting — opens a list of them, each linking to where it is dealt with.
  const highlight = (() => {
    if (reviewQueue && reviewCount > 0) {
      return {
        label: `${reviewCount} ${reviewCount === 1 ? "item needs" : "items need"} your review`,
        urgent: true,
        href: reviewCount === 1 ? reviewQueue[0].href : undefined,
        items:
          reviewCount > 1
            ? reviewQueue.map((item) => ({
                id: `${item.kind}-${item.id}`,
                title: item.title,
                subtitle: item.subtitle,
                href: item.href,
              }))
            : undefined,
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
        href: "/stock/products?tab=requests",
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

  const hasAnything =
    stock ||
    reviewQueue ||
    team ||
    departments ||
    activity ||
    dispatch;

  /* ---- KPI tiles, in reading order ------------------------------------ */
  const tiles: { key: string; node: ReactNode }[] = [];
  if (stock) {
    // Entry operators (no stock.view) cannot browse entries: they get their
    // drafts and nothing more
    if (has(PERMISSIONS.STOCK_VIEW)) {
      tiles.push({
        key: "entries",
        node: (
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
        ),
      });
    }
    if (has(PERMISSIONS.STOCK_CREATE)) {
      tiles.push({
        key: "drafts",
        node: (
          <StatCard title="Drafts" value={stock.stats.drafts} description="Not yet submitted" icon={FileText} tone="draft" href="/stock" />
        ),
      });
    }
    if (has(PERMISSIONS.STOCK_VIEW)) {
      tiles.push(
        {
          key: "pending",
          node: (
            <StatCard
              title="Pending"
              value={stock.stats.submitted}
              description={has(PERMISSIONS.STOCK_APPROVE) ? "Awaiting your review" : "Awaiting approval"}
              icon={Clock}
              tone="pending"
              trend={stock.trends.pending.series}
              deltaPct={stock.trends.pending.deltaPct}
              href="/stock"
            />
          ),
        },
        {
          key: "approved",
          node: (
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
          ),
        }
      );
    }
    if (has(PERMISSIONS.STOCK_VALUE_VIEW)) {
      tiles.push({
        key: "value",
        node: (
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
        ),
      });
    }
  }
  if (departmentMemberCount !== null) {
    tiles.push({
      key: "members",
      node: (
        <StatCard title="Department Members" value={departmentMemberCount} description="Active members" icon={Users} tone="info" href="/users" />
      ),
    });
  }
  if (team) {
    tiles.push({
      key: "users",
      node: (
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
      ),
    });
    if (has(PERMISSIONS.DEPARTMENTS_VIEW)) {
      tiles.push({
        key: "departments",
        node: (
          <StatCard title="Departments" value={team.departmentCount} description="Active departments" icon={Building2} tone="info" href="/departments" />
        ),
      });
    }
    tiles.push({
      key: "new-users",
      node: (
        <StatCard title="New This Month" value={team.recentUsers} description="Recently added" icon={TrendingUp} tone="approved" href="/users" />
      ),
    });
  }
  // Dispatch is a module in its own right — an operator holding only dispatch
  // keys still lands on something useful
  if (dispatch) {
    tiles.push(
      {
        key: "awaiting",
        node: (
          <StatCard title="Awaiting Acceptance" value={dispatch.awaitingAcceptance} description="Consignments to accept" icon={Clock} tone="pending" href="/dispatch" />
        ),
      },
      {
        key: "in-transit",
        node: (
          <StatCard title="In Transit" value={dispatch.inTransit} description="On the road" icon={Truck} tone="info" href="/dispatch" />
        ),
      },
      {
        key: "delivered",
        node: (
          <StatCard title="Delivered" value={dispatch.deliveredThisMonth} description="This month" icon={PackageCheck} tone="approved" href="/dispatch" />
        ),
      }
    );
  }

  /* ---- panels ----------------------------------------------------------- */
  const panels: { key: string; node: ReactNode }[] = [];
  // Needs fixing — creators with rejected entries
  if (has(PERMISSIONS.STOCK_CREATE) && rejectedEntries.length > 0) {
    panels.push({ key: "fixing", node: <NeedsFixing entries={rejectedEntries} /> });
  }
  // Recent entries — anyone with stock visibility
  if (stock && has(PERMISSIONS.STOCK_VIEW)) {
    panels.push({
      key: "recent",
      node: (
        <RecentEntries
          entries={stock.stats.recentEntries}
          canCreate={has(PERMISSIONS.STOCK_CREATE)}
          seesMoney={has(PERMISSIONS.STOCK_VALUE_VIEW)}
        />
      ),
    });
  }
  // Department overview — department viewers
  if (departments && departments.length > 0) {
    panels.push({ key: "departments", node: <DepartmentPanel departments={departments} /> });
  }

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
        />
      </Reveal>

      {tiles.length > 0 && (
        <Stagger className="flex flex-wrap gap-4">
          {tiles.map((tile) => (
            <StaggerItem key={tile.key} className={TILE}>
              {tile.node}
            </StaggerItem>
          ))}
        </Stagger>
      )}

      {panels.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          {panels.map((panel, i) => (
            <div
              key={panel.key}
              // The odd one out — or the only one — spans both columns
              className={panels.length % 2 === 1 && i === panels.length - 1 ? "lg:col-span-2" : undefined}
            >
              {panel.node}
            </div>
          ))}
        </div>
      )}

      {/* Activity feed — always the full width of the page */}
      {activity && <RecentActivity activities={activity} searchable={isAdmin} />}

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

/* ---- panels: each fills its grid cell, so a row's pair line up ---------- */

function NeedsFixing({ entries }: { entries: RecentEntry[] }) {
  return (
    <Card className="h-full border-red-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <XCircle className="size-4 text-status-rejected" />
          Needs Fixing
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Stagger className="space-y-3" stagger={0.04}>
          {entries.map((entry) => (
            <StaggerItem key={entry.id}>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-red-100 p-3">
                <div className="min-w-0">
                  <p className="truncate text-body font-semibold">{entry.itemName}</p>
                  <p className="truncate text-caption text-muted-foreground">{entry.entryNumber}</p>
                  {entry.rejectionReason && (
                    <p className="mt-1 text-caption text-status-rejected">Reason: {entry.rejectionReason}</p>
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
  );
}

function RecentEntries({
  entries,
  canCreate,
  seesMoney,
}: {
  entries: RecentEntry[];
  canCreate: boolean;
  seesMoney: boolean;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Package className="size-4 text-status-approved" />
          Recent Stock Entries
        </CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <EmptyState
            emoji="📦"
            title="No stock entries yet"
            description={canCreate ? "Create your first entry to get started." : "Entries will show up here as they're created."}
            action={canCreate ? { label: "New stock entry", href: "/stock/new" } : undefined}
            className="py-8"
          />
        ) : (
          <Stagger className="space-y-3" stagger={0.04}>
            {entries.slice(0, 5).map((entry) => (
              <StaggerItem key={entry.id}>
                <Link
                  href={`/stock/${entry.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors duration-200 hover:bg-muted/60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-body font-semibold">{entry.itemName}</p>
                    <p className="truncate text-caption text-muted-foreground">
                      {entry.entryNumber} &middot; {entry.createdBy.name}
                      {seesMoney && ` · ${formatCurrency(entry.totalPrice)}`}
                    </p>
                  </div>
                  <Badge variant="outline" className={statusPill(entry.status)}>
                    {entry.status}
                  </Badge>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </CardContent>
    </Card>
  );
}

function DepartmentPanel({ departments }: { departments: DeptOverview[] }) {
  return (
    <Card className="h-full">
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
                <p className="truncate text-body font-semibold">{dept.name}</p>
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
  );
}
