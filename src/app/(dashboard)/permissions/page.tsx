import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getPermissionNames } from "@/lib/actions/permission-names";
import { PageHeader } from "@/components/shared/page-header";
import { PermissionNameList } from "./_components/permission-name-list";

/** Permission Names: the words every permission is shown with. See actions/permission-names.ts. */
export default async function PermissionNamesPage() {
  await requirePermission(PERMISSIONS.PERMISSIONS_RENAME);
  const permissions = await getPermissionNames();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Permission Names"
        description="What each permission is called and how it is described — shown on roles, profiles and grants"
      />
      <PermissionNameList permissions={permissions} />
    </div>
  );
}
