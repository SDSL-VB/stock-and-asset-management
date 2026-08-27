import { requirePermission, holdsRole } from "@/lib/rbac/check";
import { PERMISSIONS, ROLES } from "@/lib/rbac/permissions";
import { getRoles } from "@/lib/actions/roles";
import { PageHeader } from "@/components/shared/page-header";
import { RoleCardList } from "./_components/role-card-list";
import { RoleHierarchyDialog } from "./_components/role-hierarchy-dialog";

export default async function RolesPage() {
  const currentUser = await requirePermission(PERMISSIONS.ROLES_VIEW);
  const roles = await getRoles();

  const isSuperAdmin = holdsRole(currentUser, ROLES.SUPER_ADMIN);
  // Feature access is purely permission-driven (roles are only cosmetic here)
  const canCreate = currentUser.permissions.includes(PERMISSIONS.ROLES_CREATE);
  const canEdit = currentUser.permissions.includes(PERMISSIONS.ROLES_EDIT);
  const canDelete = currentUser.permissions.includes(PERMISSIONS.ROLES_DELETE);

  return (
    <div className="space-y-6">
      <PageHeader
        title={isSuperAdmin ? "Roles" : "Role Management"}
        description={
          isSuperAdmin
            ? "Manage what each role can do"
            : "Configure roles and their permissions"
        }
      >
        <RoleHierarchyDialog roles={roles} canEdit={canEdit} />
      </PageHeader>
      <RoleCardList
        roles={roles}
        simplified={isSuperAdmin}
        canCreate={canCreate}
        canDelete={canDelete}
        currentUserRole={currentUser.role}
      />
    </div>
  );
}
