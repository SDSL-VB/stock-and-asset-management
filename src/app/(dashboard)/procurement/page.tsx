import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, PROCUREMENT_PERMISSIONS } from "@/lib/rbac/permissions";
import {
  getIntents,
  getPurchaseOrders,
  getIntentFormData,
  getOrderableIntents,
  getPurchaseOrderFormData,
  getProcurementFlow,
} from "@/lib/actions/procurement";
import { PageHeader } from "@/components/shared/page-header";
import { HowTo } from "@/components/shared/how-to";
import { ProcurementManager } from "./_components/procurement-manager";

export default async function ProcurementPage() {
  const user = await requireAnyPermission(PROCUREMENT_PERMISSIONS);
  const has = (p: string) => user.permissions.includes(p);

  // Every call is guarded by the key it needs. A failed check redirects, so one
  // ungated fetch would bounce someone out of a page they can mostly use.
  const canSeeIntents =
    has(PERMISSIONS.PROCUREMENT_INTENT_VIEW) || has(PERMISSIONS.PROCUREMENT_INTENT_CREATE);
  const canRaiseIntent = has(PERMISSIONS.PROCUREMENT_INTENT_CREATE);
  const canSeeOrders = has(PERMISSIONS.PROCUREMENT_PO_VIEW);
  const canRaiseOrder = has(PERMISSIONS.PROCUREMENT_PO_CREATE);

  const [intents, orders, intentForm, orderable, orderForm, flow] = await Promise.all([
    canSeeIntents ? getIntents() : Promise.resolve([]),
    canSeeOrders ? getPurchaseOrders() : Promise.resolve([]),
    canRaiseIntent ? getIntentFormData() : Promise.resolve(null),
    canRaiseOrder ? getOrderableIntents() : Promise.resolve([]),
    canRaiseOrder ? getPurchaseOrderFormData() : Promise.resolve(null),
    getProcurementFlow(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Procurement"
        description="What we need, what we have ordered, and what is still to come"
      >
        <HowTo
          title="How buying works"
          intro="Three steps, each done by whoever is closest to it: the people who need something say so, procurement turns that into an order, and the storekeeper books the goods in when they arrive."
          sections={[
            {
              steps: [
                {
                  title: "State the need",
                  description:
                    "Anyone with the key can raise a need — what, how many, and optionally who to buy it from. It records the department asking, so procurement knows who it is for.",
                },
                {
                  title: "Turn needs into an order",
                  description: flow.requiresApproval
                    ? "Procurement verifies each need, then puts one or more onto an order for a single vendor, with the prices agreed. Verification can be switched off in Configuration."
                    : "Verification is switched off, so any stated need can go straight onto an order. Turn it back on in Configuration if that changes.",
                },
                {
                  title: "Book in what arrives",
                  description:
                    "On a stock entry, say whether the goods are fresh or against an order. Enter what actually turned up — a part delivery is fine, and the order stays open showing exactly what is still owed.",
                },
                {
                  title: "The order closes itself",
                  description:
                    "When the last outstanding unit is booked in, the order closes automatically. If a vendor will never supply the rest, close it short with a reason, and the shortfall stays visible on the line.",
                },
              ],
            },
          ]}
        />
      </PageHeader>

      <ProcurementManager
        intents={intents}
        orders={orders}
        intentForm={intentForm}
        orderableIntents={orderable}
        orderForm={orderForm}
        requiresApproval={flow.requiresApproval}
        canSeeIntents={canSeeIntents}
        canRaiseIntent={canRaiseIntent}
        canApproveIntent={has(PERMISSIONS.PROCUREMENT_INTENT_APPROVE)}
        canSeeOrders={canSeeOrders}
        canRaiseOrder={canRaiseOrder}
        canCloseOrder={has(PERMISSIONS.PROCUREMENT_PO_CLOSE)}
        canSeeValue={has(PERMISSIONS.PROCUREMENT_VALUE_VIEW)}
        currentUserId={user.id}
      />
    </div>
  );
}
