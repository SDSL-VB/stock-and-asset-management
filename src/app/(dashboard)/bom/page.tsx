import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, BOM_PERMISSIONS } from "@/lib/rbac/permissions";
import { getBomCatalog } from "@/lib/actions/bom";
import { getProductCategories } from "@/lib/actions/products";
import { PageHeader } from "@/components/shared/page-header";
import { HowTo } from "@/components/shared/how-to";
import { BomCatalog } from "./_components/bom-catalog";
import { NewBomDialog } from "./_components/new-bom-dialog";

export default async function BomCatalogPage() {
  const user = await requireAnyPermission(BOM_PERMISSIONS);
  const has = (p: string) => user.permissions.includes(p);

  // Writing a bill of materials is all it takes to open the dialog — picking a
  // product that already exists just navigates to it. Requiring products.edit
  // here hid the button from a Department Manager who holds bom.create, which
  // is exactly the capability the grant was meant to give them.
  const canStartBom = has(PERMISSIONS.BOM_CREATE) || has(PERMISSIONS.BOM_EDIT);

  // Only the "not listed, add it here" path touches the catalog, and only that
  // path needs the categories — an action gated on product permissions. Asking
  // for them unconditionally bounced the whole page.
  const canCreateProduct = has(PERMISSIONS.PRODUCTS_CREATE_MADE);

  const [products, categories] = await Promise.all([
    getBomCatalog(),
    canCreateProduct ? getProductCategories() : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bills of Materials"
        description="What you make, and what goes into each one"
      >
        {canStartBom && (
            <NewBomDialog
              categories={categories}
              canCreateProduct={canCreateProduct}
            />
          )}
        <HowTo
          title="Working with bills of materials"
          intro="A bill of materials lists the parts that go into one unit of a product. It is the same idea whether you are building a machine from raw materials or packing a complete kit."
          sections={[
            {
              steps: [
                {
                  title: "Only what you make is listed here",
                  description:
                    "Raw materials you buy in through a stock entry are not shown — they are what goes *into* a bill of materials. Use New bill of materials to turn a product into a finished product or a kit.",
                },
                {
                  title: "Add the components and quantities",
                  description:
                    "Quantity is per one unit of the product. Mark customer add-ons as optional — they stay listed but are only needed when chosen.",
                },
                {
                  title: "A manager publishes it",
                  description:
                    "Submitting sends it for approval. Anyone who can publish sees a Publish button instead and skips the queue.",
                },
                {
                  title: "Then build it",
                  description:
                    "Building consumes the components out of central stock and books the assembled product in, so dispatch offers the product as a whole and whatever was left over as itself.",
                },
              ],
            },
          ]}
        />
      </PageHeader>
      <BomCatalog
        products={products}
        canEdit={has(PERMISSIONS.BOM_EDIT)}
        canCreate={has(PERMISSIONS.BOM_CREATE)}
        canApprove={has(PERMISSIONS.BOM_APPROVE)}
      />
    </div>
  );
}
