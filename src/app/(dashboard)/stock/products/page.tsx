import { requireAnyPermission } from "@/lib/rbac/check";
import {
  PERMISSIONS,
  PRODUCT_MANAGE_PERMISSIONS,
  CATALOG_PAGE_PERMISSIONS,
} from "@/lib/rbac/permissions";
import {
  getProductsForManagement,
  getAllProductCategories,
  getProductCategories,
  getProductRequests,
} from "@/lib/actions/products";
import { getCatalogRules } from "@/lib/actions/catalog-config";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RequestProductDialog } from "../_components/request-product-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { HowTo } from "@/components/shared/how-to";
import { ProductManager } from "./_components/product-manager";
import { CatalogRequests } from "./_components/catalog-requests";

/**
 * The catalog: raw materials, products, categories — and the queue of things
 * people have asked to be added.
 *
 * The request queue lives here because this is the page that owns the thing
 * being asked for. Someone who can only ASK still opens this page, and sees
 * nothing but their own requests.
 *
 * Requests waiting on the viewer are announced at the top of the page and
 * counted in red on the Requests tab; `?tab=requests` (where the dashboard
 * links) opens that tab directly. Anyone who may ASK for a category or product
 * but not add one can do so from the header here, not only from the stock
 * entry form.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAnyPermission(CATALOG_PAGE_PERMISSIONS);
  const has = (p: string) => user.permissions.includes(p);

  const canManage = PRODUCT_MANAGE_PERMISSIONS.some(has);
  const canReviewProducts = has(PERMISSIONS.PRODUCTS_REQUEST_APPROVE);
  const canReviewCategories = has(PERMISSIONS.CATEGORIES_REQUEST_APPROVE);
  const canAsk =
    has(PERMISSIONS.PRODUCTS_REQUEST_CREATE) || has(PERMISSIONS.CATEGORIES_REQUEST_CREATE);
  const canSeeRequests = canAsk || canReviewProducts || canReviewCategories;
  // Asking is for people who cannot simply add it themselves
  const canAskCategory =
    has(PERMISSIONS.CATEGORIES_REQUEST_CREATE) && !has(PERMISSIONS.CATEGORIES_CREATE);
  const canAskProduct =
    has(PERMISSIONS.PRODUCTS_REQUEST_CREATE) &&
    !has(PERMISSIONS.PRODUCTS_CREATE) &&
    !has(PERMISSIONS.PRODUCTS_CREATE_MADE);
  // A product request names its category, so the list is needed to ask for one
  const canListCategories = has(PERMISSIONS.PRODUCTS_VIEW) || canManage;

  const [products, categories, requests, reviewCategories] = await Promise.all([
    canManage ? getProductsForManagement() : Promise.resolve([]),
    canManage ? getAllProductCategories() : Promise.resolve([]),
    canSeeRequests ? getProductRequests() : Promise.resolve([]),
    // The approve dialog needs each category's code prefix to show the code a
    // product will get. Gated on the lighter read, which reviewers all hold.
    canReviewProducts || (canAskProduct && canListCategories)
      ? getProductCategories()
      : Promise.resolve([]),
  ]);

  // What this deployment insists on. Fetched for everyone who can open the
  // page, because both the product form and the approve dialog have to mark the
  // same fields required as the server will enforce.
  const rules = await getCatalogRules();

  const pending = requests.filter((r) => r.status === "PENDING").length;
  const toReview = requests.filter(
    (r) =>
      r.status === "PENDING" &&
      (r.type === "PRODUCT" ? canReviewProducts : canReviewCategories)
  ).length;
  const tab = (await searchParams).tab === "requests" && canSeeRequests ? "requests" : "raw";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catalog"
        description="Raw materials you buy in, products you make, and the categories both live in"
      >
        {canAskCategory && (
          <RequestProductDialog categories={[]} fixedType="CATEGORY" triggerLabel="Ask for a category" />
        )}
        {canAskProduct && canListCategories && reviewCategories.length > 0 && (
          <RequestProductDialog categories={reviewCategories} fixedType="PRODUCT" triggerLabel="Ask for a product" />
        )}
        <HowTo
          title="Managing the product catalog"
          intro="The catalog is the single source of truth for item codes and names."
          sections={[
            {
              steps: [
                {
                  title: "Create categories first",
                  description:
                    "Products live inside categories (e.g. Cricket Equipment); operators pick a category before searching.",
                },
                {
                  title: "Codes come from the category, and the subcategory",
                  description:
                    "A category owns a fixed 4-digit prefix and a subcategory may add a segment of its own: Electronics (1004) + PCB + 3W_CONTROL_BOARD gives 1004-PCB-3W_CONTROL_BOARD. Neither is typed by hand — you type only the last part.",
                },
                {
                  title: "Name it short, describe it plainly",
                  description:
                    "The name is the handle people type (3W_Control_Board); the description is what it actually is (BLDC Control board). Both are searchable.",
                },
                {
                  title: "Deactivate instead of deleting",
                  description:
                    "A deactivated product disappears from new-entry search but keeps all its history.",
                },
                {
                  title: "Answer what people ask for",
                  description:
                    "Requests appear on the Requests tab. Approving one is what creates the product or category.",
                },
              ],
            },
          ]}
        />
      </PageHeader>

      {toReview > 0 && canManage && tab !== "requests" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-status-pending/40 bg-status-pending-bg px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Inbox className="h-4 w-4 text-status-pending" />
            {toReview} catalog {toReview === 1 ? "request is" : "requests are"} waiting for your review
          </p>
          <Button render={<Link href="/stock/products?tab=requests" />} nativeButton={false} size="sm" variant="outline">
            Review
          </Button>
        </div>
      )}

      {canManage ? (
        <ProductManager
          defaultTab={tab}
          products={products}
          categories={categories}
          canCreateProducts={has(PERMISSIONS.PRODUCTS_CREATE)}
          canEditProducts={has(PERMISSIONS.PRODUCTS_EDIT)}
          canCreateCategories={has(PERMISSIONS.CATEGORIES_CREATE)}
          canEditCategories={has(PERMISSIONS.CATEGORIES_EDIT)}
          canOverrideCode={has(PERMISSIONS.PRODUCTS_CODE_OVERRIDE)}
          canEditPrefix={has(PERMISSIONS.CATEGORIES_PREFIX_EDIT)}
          canCreateMade={has(PERMISSIONS.PRODUCTS_CREATE_MADE)}
          canDeleteProducts={has(PERMISSIONS.PRODUCTS_DELETE)}
          canDeleteCategories={has(PERMISSIONS.CATEGORIES_DELETE)}
          rules={rules}
          canEditSuppliers={
            has(PERMISSIONS.VENDORS_EDIT) || has(PERMISSIONS.PRODUCTS_EDIT) || has(PERMISSIONS.STOCK_LOWSTOCK_MANAGE)
          }
          requestsTab={
            canSeeRequests
              ? {
                  pending,
                  toReview,
                  content: (
                    <CatalogRequests
                      requests={requests}
                      categories={reviewCategories}
                      rules={rules}
                      canReviewProducts={canReviewProducts}
                      canReviewCategories={canReviewCategories}
                      canOverrideCode={has(PERMISSIONS.PRODUCTS_CODE_OVERRIDE)}
                      viewerId={user.id}
                    />
                  ),
                }
              : null
          }
        />
      ) : (
        // Someone who can only ask has no catalog to manage, so the requests
        // stand alone rather than as one tab of three they cannot open.
        <CatalogRequests
          requests={requests}
          categories={reviewCategories}
          canReviewProducts={canReviewProducts}
          canReviewCategories={canReviewCategories}
          canOverrideCode={has(PERMISSIONS.PRODUCTS_CODE_OVERRIDE)}
          viewerId={user.id}
          rules={rules}
        />
      )}
    </div>
  );
}
