import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getRoleById, getAllPermissions } from "@/lib/actions/roles";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PermissionEditor } from "./_components/permission-editor";

export default async function RoleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const currentUser = await requirePermission(PERMISSIONS.ROLES_VIEW);
  const { id } = await params;

  const [role, allPermissions] = await Promise.all([
    getRoleById(id),
    getAllPermissions(),
  ]);

  if (!role) notFound();

  const canEdit = currentUser.permissions.includes(PERMISSIONS.ROLES_EDIT);

  return (
    <div className="space-y-6">
      <PageHeader
        title={role.name}
        description={`Configure permissions for "${role.name}"`}
      >
        <Link href="/roles" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Link>
      </PageHeader>

      <PermissionEditor
        roleId={role.id}
        roleName={role.name}
        allPermissions={allPermissions}
        currentPermissionIds={role.permissions.map((rp) => rp.permission.id)}
        canEdit={canEdit}
      />
    </div>
  );
}
