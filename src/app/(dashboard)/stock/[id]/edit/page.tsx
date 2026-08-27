import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, resolveStockScope } from "@/lib/rbac/permissions";
import { getStockEntryById, getFieldConfigs, getAttachmentTypeConfigs } from "@/lib/actions/stock";
import { getProductCategories } from "@/lib/actions/products";
import { getLocationsForSelect, getMyLocationId } from "@/lib/actions/locations";
import { getClientsForEntryForm } from "@/lib/actions/clients";
import { getVendorsForEntryForm } from "@/lib/actions/vendors";
import { PageHeader } from "@/components/shared/page-header";
import { StockEntryForm } from "../../_components/stock-entry-form";
import { notFound, redirect } from "next/navigation";

export default async function EditStockEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAnyPermission([PERMISSIONS.STOCK_EDIT, PERMISSIONS.STOCK_CREATE]);
  const { id } = await params;
  const entry = await getStockEntryById(id);

  if (!entry) notFound();

  // Only DRAFT or REJECTED can be edited
  if (entry.status !== "DRAFT" && entry.status !== "REJECTED") {
    redirect(`/stock/${id}`);
  }

  // Only the creator (or someone whose stock scope covers everything) can edit
  if (entry.createdBy.id !== user.id && resolveStockScope(user) !== "all") {
    redirect(`/stock/${id}`);
  }

  const [categories, fieldConfigs, attachmentTypes, locations, myLocationId, clients, vendors] = await Promise.all([
    getProductCategories(),
    getFieldConfigs(),
    getAttachmentTypeConfigs(),
    getLocationsForSelect(),
    getMyLocationId(),
    getClientsForEntryForm(),
    getVendorsForEntryForm(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit ${entry.entryNumber}`}
        description={`Editing stock entry for ${entry.itemName}`}
      />
      <StockEntryForm
        categories={categories}
        locations={locations}
        clients={clients}
        vendors={vendors}
        defaultLocationId={myLocationId}
        fieldConfigs={fieldConfigs}
        attachmentTypes={attachmentTypes}
        canSetBatch={user.permissions.includes(PERMISSIONS.STOCK_BATCH_EDIT)}
        canEditWarranty={user.permissions.includes(PERMISSIONS.STOCK_WARRANTY_EDIT)}
        canCreateProducts={user.permissions.includes(PERMISSIONS.PRODUCTS_CREATE)}
        canCreateCategories={user.permissions.includes(PERMISSIONS.CATEGORIES_CREATE)}
        canRequestProducts={user.permissions.includes(PERMISSIONS.PRODUCTS_REQUEST_CREATE)}
        canRequestCategories={user.permissions.includes(PERMISSIONS.CATEGORIES_REQUEST_CREATE)}
        initialData={{
          id: entry.id,
          productId: entry.productId,
          itemCode: entry.itemCode,
          itemName: entry.itemName,
          supplierName: entry.supplierName,
          quantity: entry.quantity,
          unitPrice: entry.unitPrice,
          invoiceNumber: entry.invoiceNumber,
          locationId: entry.locationId,
          clientId: entry.clientId,
          batchNumber: entry.batchNumber,
          warranty: entry.warranty,
          vendorId: entry.vendorId,
          clientName: entry.clientName,
          clientLocation: entry.clientLocation,
          customFields: entry.customFields as Record<string, unknown> | null,
          status: entry.status,
          product: entry.product,
        }}
      />
    </div>
  );
}
