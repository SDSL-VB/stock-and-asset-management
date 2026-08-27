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
 */
export default async function ProductsPage() {
  const user = await requireAnyPermission(CATALOG_PAGE_PERMISSIONS);
  const has = (p: string) => user.permissions.includes(p);

  const canManage = PRODUCT_MANAGE_PERMISSIONS.some(has);
  const canReviewProducts = has(PERMISSIONS.PRODUCTS_REQUEST_APPROVE);
  const canReviewCategories = has(PERMISSIONS.CATEGORIES_REQUEST_APPROVE);
  const canAsk =
    has(PERMISSIONS.PRODUCTS_REQUEST_CREATE) || has(PERMISSIONS.CATEGORIES_REQUEST_CREATE);
  const canSeeRequests = canAsk || canReviewProducts || canReviewCategories;

  const [products, categories, requests, reviewCategories] = await Promise.all([
    canManage ? getProductsForManagement() : Promise.resolve([]),
    canManage ? getAllProductCategories() : Promise.resolve([]),
    canSeeRequests ? getProductRequests() : Promise.resolve([]),
    // The approve dialog needs each category's code prefix to show the code a
    // product will get. Gated on the lighter read, which reviewers all hold.
    canReviewProducts ? getProductCategories() : Promise.resolve([]),
  ]);

  const pending = requests.filter((r) => r.status === "PENDING").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catalog"
        description="Raw materials you buy in, products you make, and the categories both live in"
      >
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
                  title: "Codes come from the category",
                  description:
                    "Every category owns a fixed 4-digit prefix (Electronics 1004 → 1004-TV55). The prefix is never typed by hand.",
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

      {canManage ? (
        <ProductManager
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
          requestsTab={
            canSeeRequests
              ? {
                  pending,
                  content: (
                    <CatalogRequests
                      requests={requests}
                      categories={reviewCategories}
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
        />
      )}
    </div>
  );
}
