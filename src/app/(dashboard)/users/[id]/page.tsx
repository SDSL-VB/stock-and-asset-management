import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  getUserById,
  getRolesForSelect,
  getDepartmentsForSelect,
  getUserPasswordMeta,
} from "@/lib/actions/users";
import { getUserPermissionDetail } from "@/lib/actions/user-permissions";
import { notFound } from "next/navigation";
import { UserProfile } from "./_components/user-profile";
import { ExtraPermissionsCard } from "./_components/extra-permissions-card";
import { AdditionalRolesCard } from "./_components/additional-roles-card";

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const currentUser = await requirePermission(PERMISSIONS.USERS_VIEW);

  const { id } = await params;
  const [user, roles, departments] = await Promise.all([
    getUserById(id),
    getRolesForSelect(),
    getDepartmentsForSelect(),
  ]);

  if (!user) notFound();

  // Only fetched for viewers who hold a password permission — the action itself
  // redirects otherwise, so the card simply never renders for everyone else.
  const canSeeCredentials =
    currentUser.permissions.includes(PERMISSIONS.USERS_PASSWORD_VIEW) ||
    currentUser.permissions.includes(PERMISSIONS.USERS_PASSWORD_EDIT);
  const passwordMeta = canSeeCredentials ? await getUserPasswordMeta(id) : null;

  // Handing out permissions is its own grant, and never applies to yourself —
  // so the card is simply absent rather than shown disabled.
  const canGrant =
    currentUser.permissions.includes(PERMISSIONS.USERS_PERMISSIONS_GRANT) &&
    currentUser.id !== id;
  const permissionDetail = canGrant ? await getUserPermissionDetail(id) : null;

  // Handing out a second role is part of editing someone, and never applies to
  // yourself — so the card is absent rather than shown disabled.
  const canAssignRoles =
    currentUser.permissions.includes(PERMISSIONS.USERS_EDIT) && currentUser.id !== id;

  return (
    <UserProfile
      user={user}
      roles={roles}
      departments={departments}
      currentUserRoles={currentUser.roles}
      currentUserPermissions={currentUser.permissions}
      currentUserId={currentUser.id}
      passwordMeta={passwordMeta}
      additionalRoles={
        canAssignRoles ? (
          <AdditionalRolesCard
            userId={id}
            userName={user.name}
            primaryRoleName={user.role.name}
            held={user.additionalRoles}
            assignable={roles}
          />
        ) : null
      }
      extraPermissions={
        permissionDetail && !permissionDetail.isSystem ? (
          <ExtraPermissionsCard
            userId={id}
            userName={permissionDetail.user.name}
            roleName={permissionDetail.user.roleName}
            rolePermissionCount={permissionDetail.rolePermissionCount}
            grants={permissionDetail.grants}
            grantable={permissionDetail.grantable}
          />
        ) : null
      }
    />
  );
}
