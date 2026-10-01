import { requireAnyPermission } from "@/lib/rbac/check";
import {
  PERMISSIONS,
  FIND_STOCK_PERMISSIONS,
} from "@/lib/rbac/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { getFindStockFilters, getMySiteStock } from "@/lib/actions/racks";
import { StockFinder } from "./_components/stock-finder";

/**
 * Find stock: type a material, see whether there is any free to use and which
 * rack it is on — "Rack 10, row 3" — so someone can walk straight to it.
 * `?q=` opens with a search already run, for links from elsewhere.
 *
 * Before anything is typed the page shows what is on the shelves at the
 * person's own site, and what they searched for recently. Somebody with no
 * site sees no stock until they search, and the answer then spans every site
 * they may see.
 */
export default async function FindStockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAnyPermission(FIND_STOCK_PERMISSIONS);
  const [{ categories, locations }, siteStock, params] = await Promise.all([
    getFindStockFilters(),
    getMySiteStock(),
    searchParams,
  ]);
  const q = params.q;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Find Stock"
        description="Is it here, how much is free, and which rack and row to go to"
      />
      <StockFinder
        initialQuery={typeof q === "string" ? q : ""}
        categories={categories}
        locations={locations}
        siteStock={siteStock}
      />
    </div>
  );
}
