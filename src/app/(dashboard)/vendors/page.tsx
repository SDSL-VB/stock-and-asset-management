import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getVendors } from "@/lib/actions/vendors";
import { PageHeader } from "@/components/shared/page-header";
import { HowTo } from "@/components/shared/how-to";
import { VendorManager } from "./_components/vendor-manager";

export default async function VendorsPage() {
  const user = await requireAnyPermission([
    PERMISSIONS.VENDORS_VIEW,
    PERMISSIONS.VENDORS_CREATE,
    PERMISSIONS.VENDORS_EDIT,
  ]);
  const has = (p: string) => user.permissions.includes(p);

  const vendors = await getVendors();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendors"
        description="Suppliers we buy from, with their GST and address details"
      >
        <HowTo
          title="Managing vendors"
          intro="Vendors are records, not typed names — so every entry from the same supplier carries the same GST number."
          sections={[
            {
              steps: [
                { title: "Add a vendor once", description: "Name, GST number and address. Only admins maintain this list." },
                { title: "Operators pick, never type", description: "The stock entry form offers this list instead of a free-text supplier box." },
                { title: "Deactivate instead of deleting", description: "A deactivated vendor disappears from the entry form but keeps every past entry intact." },
              ],
            },
          ]}
        />
      </PageHeader>
      <VendorManager
        vendors={vendors}
        canCreate={has(PERMISSIONS.VENDORS_CREATE)}
        canEdit={has(PERMISSIONS.VENDORS_EDIT)}
        canDelete={has(PERMISSIONS.VENDORS_DELETE)}
        canExport={has(PERMISSIONS.VENDORS_EXPORT)}
      />
    </div>
  );
}
