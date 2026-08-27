import { requirePermission, hasPermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getDepartments } from "@/lib/actions/departments";
import { PageHeader } from "@/components/shared/page-header";
import { HowTo } from "@/components/shared/how-to";
import { DepartmentList } from "./_components/department-list";
import { CreateDepartmentDialog } from "./_components/create-department-dialog";
import { getLocationsForSelect } from "@/lib/actions/locations";

export default async function DepartmentsPage() {
  const user = await requirePermission(PERMISSIONS.DEPARTMENTS_VIEW);
  const [departments, locations] = await Promise.all([
    getDepartments(),
    getLocationsForSelect(),
  ]);

  const canCreate = hasPermission(user.permissions, PERMISSIONS.DEPARTMENTS_CREATE);
  const canEdit = hasPermission(user.permissions, PERMISSIONS.DEPARTMENTS_EDIT);
  const canDelete = hasPermission(user.permissions, PERMISSIONS.DEPARTMENTS_DELETE);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Departments"
        description="Manage departments and their team members"
      >
        <HowTo
          title="Managing departments"
          sections={[
            {
              steps: [
                { title: "Create a department", description: "Give it a name and description; members and stock can be assigned to it." },
                { title: "Add members from the department page", description: "Open a department and use \"Add Member\" — people already in another department are moved over." },
                { title: "Deactivate to pause, delete to remove", description: "Deletion is blocked while members, stock, or requests still reference the department; deactivating keeps history." },
              ],
            },
          ]}
        />
        {canCreate && <CreateDepartmentDialog locations={locations} />}
      </PageHeader>
      <DepartmentList
        locations={locations} departments={departments} canEdit={canEdit} canDelete={canDelete} />
    </div>
  );
}
