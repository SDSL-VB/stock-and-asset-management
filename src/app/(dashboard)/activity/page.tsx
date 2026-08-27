import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS, resolveActivityScope } from "@/lib/rbac/permissions";
import { getActivityLogs } from "@/lib/actions/activity";
import { getDepartmentsForSelect } from "@/lib/actions/users";
import { PageHeader } from "@/components/shared/page-header";
import { ActivityTable } from "./_components/activity-table";

export default async function ActivityPage() {
  const user = await requirePermission(PERMISSIONS.ACTIVITY_VIEW);

  const [{ logs, total, allowedCategories }, departments] = await Promise.all([
    getActivityLogs({ limit: 50 }),
    // Filtering BY department is only meaningful when you can see more than
    // one. Anyone narrower is already scoped to theirs, so the filter is absent
    // rather than present-and-useless.
    resolveActivityScope(user) === "all"
      ? getDepartmentsForSelect()
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity Log"
        description={
          allowedCategories.length > 0
            ? `${total} recorded, across the ${allowedCategories.length} part${allowedCategories.length === 1 ? "" : "s"} you can see`
            : "Everything is recorded — you have not been given a part of it to read"
        }
      />
      <ActivityTable
        logs={logs}
        departments={departments}
        allowedCategories={allowedCategories}
      />
    </div>
  );
}
