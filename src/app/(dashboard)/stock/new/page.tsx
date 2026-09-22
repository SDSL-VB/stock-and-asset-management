import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import Link from "next/link";
import { Package, PackageOpen } from "lucide-react";
import { getProductCategories, getProductOptions } from "@/lib/actions/products";
import { getFieldConfigs, getAttachmentTypeConfigs } from "@/lib/actions/stock";
import { getLocationsForSelect, getMyLocationId } from "@/lib/actions/locations";
import { getClientsForEntryForm } from "@/lib/actions/clients";
import { getVendorsForEntryForm } from "@/lib/actions/vendors";
import { getOpenOrderLines } from "@/lib/actions/procurement";
import { PageHeader } from "@/components/shared/page-header";
import { HowTo } from "@/components/shared/how-to";
import { StockEntryForm } from "../_components/stock-entry-form";
import { DeliveryForm } from "../_components/delivery-form";
import { cn } from "@/lib/utils";

/**
 * Booking goods in, two ways:
 *
 *   One item                  the full stock entry form — warranty, goods going
 *                             straight to a client, custom fields.
 *   Several items (?mode=delivery)
 *                             everything that came in one box on one invoice,
 *                             from any categories, booked together. Each line
 *                             still becomes its own stock entry. See
 *                             deliveries.ts.
 */
export default async function NewStockEntryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePermission(PERMISSIONS.STOCK_CREATE);
  const isDelivery = (await searchParams).mode === "delivery";

  const modeSwitch = (
    <div className="inline-flex rounded-lg border p-1">
      {[
        { href: "/stock/new", label: "One item", icon: Package, active: !isDelivery },
        { href: "/stock/new?mode=delivery", label: "Several items, one delivery", icon: PackageOpen, active: isDelivery },
      ].map((m) => (
        <Link
          key={m.href}
          href={m.href}
          className={cn(
            "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            m.active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          )}
        >
          <m.icon className="h-4 w-4" />
          {m.label}
        </Link>
      ))}
    </div>
  );

  if (isDelivery) {
    const [products, vendors, locations, myLocationId, openOrderLines] = await Promise.all([
      getProductOptions(),
      getVendorsForEntryForm(),
      getLocationsForSelect(),
      getMyLocationId(),
      getOpenOrderLines(),
    ]);
    return (
      <div className="space-y-6">
        <PageHeader
          title="New Delivery"
          description="Everything that arrived together on one invoice — any categories — booked in at once"
        />
        {modeSwitch}
        <DeliveryForm
          products={products}
          vendors={vendors}
          locations={locations}
          defaultLocationId={myLocationId}
          openOrderLines={openOrderLines}
          canSetBatch={user.permissions.includes(PERMISSIONS.STOCK_BATCH_EDIT)}
        />
      </div>
    );
  }

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
      {modeSwitch}
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
