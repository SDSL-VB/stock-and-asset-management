import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getProductCategories } from "@/lib/actions/products";
import { getFieldConfigs, getAttachmentTypeConfigs } from "@/lib/actions/stock";
import { getLocationsForSelect, getMyLocationId } from "@/lib/actions/locations";
import { getClientsForEntryForm } from "@/lib/actions/clients";
import { getVendorsForEntryForm } from "@/lib/actions/vendors";
import { getOpenOrderLines } from "@/lib/actions/procurement";
import { PageHeader } from "@/components/shared/page-header";
import { HowTo } from "@/components/shared/how-to";
import { StockEntryForm } from "../_components/stock-entry-form";

export default async function NewStockEntryPage() {
  const user = await requirePermission(PERMISSIONS.STOCK_CREATE);

  const [categories, fieldConfigs, attachmentTypes, locations, myLocationId, clients, vendors, openOrderLines] = await Promise.all([
    getProductCategories(),
    getFieldConfigs(),
    getAttachmentTypeConfigs(),
    getLocationsForSelect(),
    getMyLocationId(),
    getClientsForEntryForm(),
    getVendorsForEntryForm(),
    getOpenOrderLines(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="New Stock Entry"
        description="Received stock goes into central stock first — it can be moved to a department after approval"
      >
        <HowTo
          title="Filling in a stock entry"
          sections={[
            {
              steps: [
                { title: "Pick the category, then search the product", description: "Type the product name — the exact catalog name and code fill in automatically. If it's missing, use \"Request Product / Category\"." },
                { title: "Pick the vendor, then enter quantity and unit price", description: "Vendors come from the list admins maintain, so the GST details stay consistent. The total is calculated for you." },
                { title: "Choose where the stock was received", description: "Your own site is preselected. If the goods ship straight from the vendor to a client, tick that box and add the client's details." },
                { title: "Attach documents", description: "Saving a draft lets you upload attachments; required ones must be uploaded before submitting." },
                { title: "Submit for approval", description: "Or save as a draft and finish later." },
              ],
            },
          ]}
        />
      </PageHeader>
      <StockEntryForm
        openOrderLines={openOrderLines}
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
      />
    </div>
  );
}
