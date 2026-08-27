import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getRolesForSelect, getDepartmentsForSelect } from "@/lib/actions/users";
import { PageHeader } from "@/components/shared/page-header";
import { UserForm } from "../_components/user-form";

export default async function NewUserPage() {
  await requirePermission(PERMISSIONS.USERS_CREATE);

  const [roles, departments] = await Promise.all([
    getRolesForSelect(),
    getDepartmentsForSelect(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add Team Member"
        description="Fill in the details below to add a new team member"
      />
      <UserForm roles={roles} departments={departments} />
    </div>
  );
}
