import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/lib/rbac/check";
import { maySeeEntryMoney } from "@/lib/stock-visibility";
import {
  PERMISSIONS,
  STOCK_ENTRIES_PAGE_PERMISSIONS,
} from "@/lib/rbac/permissions";
import { getDelivery } from "@/lib/actions/deliveries";
import { getAttachmentTypeConfigs } from "@/lib/actions/stock";
import { PageHeader } from "@/components/shared/page-header";
import { DeliveryView } from "../../_components/delivery-view";

/**
 * One delivery: the lines that arrived together, their documents, and the
 * submit / approve / send back that apply to all of them at once.
 *
 * Lines the viewer may not see (another site's stock, for someone narrowed to
 * their own) are left out exactly as on the stock list; a delivery with no
 * visible line is reported as not found.
 */
export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnyPermission(STOCK_ENTRIES_PAGE_PERMISSIONS);
  const { id } = await params;

  const [delivery, attachmentTypes] = await Promise.all([
    getDelivery(id),
    user.permissions.includes(PERMISSIONS.STOCK_CREATE) ? getAttachmentTypeConfigs() : Promise.resolve([]),
  ]);
  if (!delivery) notFound();

  const first = delivery.entries[0];
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Delivery ${delivery.deliveryNumber}`}
        description={`${first.supplierName}${first.invoiceNumber ? ` · invoice ${first.invoiceNumber}` : ""} · ${first.location?.name ?? "—"}`}
        backHref="/stock"
      />
      <DeliveryView
        delivery={delivery}
        attachmentTypes={attachmentTypes}
        viewerId={user.id}
        canCreate={user.permissions.includes(PERMISSIONS.STOCK_CREATE)}
        // A delivery is all service or none of it; service stock has its own approvers
        canApprove={user.permissions.includes(
          first.forService ? PERMISSIONS.STOCK_SERVICE_APPROVE : PERMISSIONS.STOCK_APPROVE
        )}
        // The same rule the server used to decide whether prices were sent
        canSeeValue={delivery.entries.every((e) => maySeeEntryMoney(e, user))}
      />
    </div>
  );
}
