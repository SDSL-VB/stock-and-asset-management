import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getApprovalFlows } from "@/lib/actions/approval-settings";
import { PageHeader } from "@/components/shared/page-header";
import { ApprovalFlowList } from "./_components/approval-flow-list";

/** Approval Flows: every approval, who decides it, and the optional ones' switches. */
export default async function ApprovalFlowsPage() {
  await requirePermission(PERMISSIONS.APPROVALS_CONFIGURE);
  const { flows, switches } = await getApprovalFlows();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approval Flows"
        description="Every approval in the system and who decides it. To change who decides, change which roles hold the permission on the Roles page."
      />
      <ApprovalFlowList flows={flows} switches={switches} />
    </div>
  );
}
