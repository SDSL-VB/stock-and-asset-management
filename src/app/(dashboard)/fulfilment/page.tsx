import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getFulfilmentProducts, getRequestDestinations } from "@/lib/actions/fulfilment";
import { PageHeader } from "@/components/shared/page-header";
import { FulfilmentPlanner } from "./_components/fulfilment-planner";

/**
 * "Can we meet an order of N, and from where?" — what the viewer's site holds,
 * what it could build from components on hand, and asking another site for the
 * rest. Opened by fulfilment.view alone; it used to be a tab on Builds, which
 * let planning open a page full of build runs.
 */
export default async function FulfilmentPage() {
  const user = await requirePermission(PERMISSIONS.FULFILMENT_VIEW);
  const canRequest = user.permissions.includes(PERMISSIONS.FULFILMENT_REQUEST);

  const [products, destinations] = await Promise.all([
    getFulfilmentProducts(),
    canRequest ? getRequestDestinations() : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fulfilment"
        description="Can an order be met, and where the stock would come from"
      />
      <FulfilmentPlanner products={products} canRequest={canRequest} destinations={destinations} />
    </div>
  );
}
