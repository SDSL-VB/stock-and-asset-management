import { requirePermission, hasPermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getDepartmentById, getAssignableUsers } from "@/lib/actions/departments";
import { getDepartmentHoldingSplit } from "@/lib/actions/assets";
import { getRolesForSelect } from "@/lib/actions/users";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DepartmentDetail } from "./_components/department-detail";

export default async function DepartmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission(PERMISSIONS.DEPARTMENTS_VIEW);
  const { id } = await params;
  const department = await getDepartmentById(id);

  if (!department) notFound();

  const canManageMembers = hasPermission(user.permissions, PERMISSIONS.USERS_EDIT);
  const canCreateUsers = hasPermission(user.permissions, PERMISSIONS.USERS_CREATE);
  const [candidates, roles, holdings] = await Promise.all([
    canManageMembers ? getAssignableUsers(id) : Promise.resolve([]),
    canCreateUsers ? getRolesForSelect() : Promise.resolve([]),
    getDepartmentHoldingSplit(id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={department.name}
        description={department.description ?? undefined}
      >
        <Link href="/departments" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Link>
      </PageHeader>
      {/* What the department holds, split by what the movement said it was */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-2xl font-semibold tabular-nums">{holdings.stockQuantity}</p>
          <p className="text-sm text-muted-foreground">
            Units of stock across {holdings.stockLines} movement
            {holdings.stockLines === 1 ? "" : "s"}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-2xl font-semibold tabular-nums">{holdings.assetQuantity}</p>
          <p className="text-sm text-muted-foreground">
            Units held as assets across {holdings.assetLines} movement
            {holdings.assetLines === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <DepartmentDetail
        department={department}
        canManageMembers={canManageMembers}
        canCreateUsers={canCreateUsers}
        roles={roles}
        candidates={candidates}
        currentUserId={user.id}
      />
    </div>
  );
}
