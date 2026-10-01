import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, MATERIALS_PAGE_PERMISSIONS } from "@/lib/rbac/permissions";
import { getMaterialRequests } from "@/lib/actions/materials";
import { getProductOptions } from "@/lib/actions/products";
import { PageHeader } from "@/components/shared/page-header";
import { MaterialRequestList } from "./_components/material-request-list";

/**
 * Material requests: a department asking central stock for materials.
 *
 * Raised here or from a short build; approved by the department's manager;
 * supplied by the Stock Manager, who moves the stock into the department. What
 * central stock lacks becomes a need for the Buyer. See actions/materials.ts.
 */
export default async function MaterialsPage() {
  const user = await requireAnyPermission(MATERIALS_PAGE_PERMISSIONS);
  const canRequest = user.permissions.includes(PERMISSIONS.MATERIALS_REQUEST);

  const [requests, products] = await Promise.all([
    getMaterialRequests(),
    canRequest ? getProductOptions() : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Material Requests"
        description="Your department asking central stock for materials — approved by its manager, supplied by the Stock Manager"
      />
      <MaterialRequestList requests={requests} products={products} canRequest={canRequest} />
    </div>
  );
}
