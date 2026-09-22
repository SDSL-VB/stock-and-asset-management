import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
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
  const user = await requireAnyPermission([PERMISSIONS.STOCK_VIEW, PERMISSIONS.STOCK_CREATE]);
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
        canApprove={user.permissions.includes(PERMISSIONS.STOCK_APPROVE)}
        canSeeValue={user.permissions.includes(PERMISSIONS.STOCK_VALUE_VIEW)}
      />
    </div>
  );
}
