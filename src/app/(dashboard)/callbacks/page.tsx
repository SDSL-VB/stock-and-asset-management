import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, CALLBACKS_PAGE_PERMISSIONS } from "@/lib/rbac/permissions";
import { getCallBacks } from "@/lib/actions/callbacks";
import { getDispatchableStock } from "@/lib/actions/dispatch";
import { getProductOptions } from "@/lib/actions/products";
import { PageHeader } from "@/components/shared/page-header";
import { CallBackList } from "./_components/callback-list";

/**
 * Call-backs: a batch recalled, everyone who has it, and what Service did about
 * it — returns booked in and parts swapped on site. See actions/callbacks.ts.
 */
export default async function CallBacksPage() {
  const user = await requireAnyPermission(CALLBACKS_PAGE_PERMISSIONS);
  const has = (p: string) => user.permissions.includes(p);
  const canSwap = has(PERMISSIONS.SERVICE_SWAP);
  // Sending a part from service stock raises a consignment, so it needs dispatch too
  const canSendFromServiceStock = canSwap && has(PERMISSIONS.DISPATCH_CREATE);

  const [callBacks, stock, products] = await Promise.all([
    getCallBacks(),
    canSendFromServiceStock ? getDispatchableStock(undefined) : Promise.resolve([]),
    canSwap ? getProductOptions() : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Call-backs"
        description="A batch recalled — who has it, what came back, and parts swapped at customers"
      />
      <CallBackList
        callBacks={callBacks}
        canRaise={has(PERMISSIONS.CALLBACKS_RAISE)}
        serviceStock={stock.filter((s) => s.forService)}
        products={products}
      />
    </div>
  );
}
