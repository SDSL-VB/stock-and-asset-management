import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, STOCK_CONFIG_PERMISSIONS } from "@/lib/rbac/permissions";
import {
  getFieldConfigs,
  getAttachmentTypeConfigs,
  getApprovalFlows,
} from "@/lib/actions/stock-config";
import { getBomFlow } from "@/lib/actions/bom-flow";
import { getProcurementFlow } from "@/lib/actions/procurement";
import { getRolesForSelect, getDepartmentsForSelect } from "@/lib/actions/users";
import { PageHeader } from "@/components/shared/page-header";
import { StockConfigureForm } from "../stock/_components/stock-configure-form";
import { HowToGuide } from "../stock/_components/how-to-guide";
import { BomFlowCard } from "./_components/bom-flow-card";
import { ProcurementFlowCard } from "./_components/procurement-flow-card";

/**
 * Everything configurable, in one place.
 *
 * It used to be "Stock Configuration" and it configured stock entries only —
 * but approval flows stopped being a stock-entry idea the moment bills of
 * materials needed approving too. Each section is gated on its own key, so
 * someone with one config permission sees one section rather than four with
 * three of them dead.
 */
export default async function ConfigurePage() {
  const user = await requireAnyPermission(STOCK_CONFIG_PERMISSIONS);
  const has = (p: string) => user.permissions.includes(p);

  const canConfigureFields = has(PERMISSIONS.STOCK_CONFIG_FIELDS);
  const canConfigureAttachments = has(PERMISSIONS.STOCK_CONFIG_ATTACHMENTS);
  const canConfigureFlows = has(PERMISSIONS.STOCK_CONFIG_FLOWS);
  const canConfigureBomFlow = has(PERMISSIONS.CONFIG_FLOWS_BOM);
  const canConfigureProcurement = has(PERMISSIONS.PROCUREMENT_CONFIG);

  const [fieldConfigs, attachmentTypes, approvalFlows, roles, departments, bomFlow, procurementFlow] =
    await Promise.all([
      canConfigureFields ? getFieldConfigs() : Promise.resolve([]),
      canConfigureAttachments ? getAttachmentTypeConfigs() : Promise.resolve([]),
      canConfigureFlows ? getApprovalFlows() : Promise.resolve([]),
      getRolesForSelect(),
      getDepartmentsForSelect(),
      canConfigureBomFlow ? getBomFlow() : Promise.resolve(null),
      canConfigureProcurement ? getProcurementFlow() : Promise.resolve(null),
    ]);

  const hasStockSections =
    canConfigureFields || canConfigureAttachments || canConfigureFlows;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuration"
        description="Stock entry fields, attachment types, and the approval rules for entries and bills of materials"
      >
        <HowToGuide />
      </PageHeader>

      {hasStockSections && (
        <StockConfigureForm
          fieldConfigs={fieldConfigs}
          attachmentTypes={attachmentTypes}
          approvalFlows={approvalFlows}
          roles={roles}
          departments={departments}
          canConfigureFields={canConfigureFields}
          canConfigureAttachments={canConfigureAttachments}
          canConfigureFlows={canConfigureFlows}
        />
      )}

      {procurementFlow && (
        <ProcurementFlowCard
          requiresApproval={procurementFlow.requiresApproval}
          approverRoleId={procurementFlow.approverRoleId}
          roles={roles}
        />
      )}

      {bomFlow && (
        <BomFlowCard
          requiresApproval={bomFlow.requiresApproval}
          approverRoleId={bomFlow.approverRoleId}
          roles={roles}
        />
      )}
    </div>
  );
}
