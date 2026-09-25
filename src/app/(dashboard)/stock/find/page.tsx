import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { getFindStockFilters } from "@/lib/actions/racks";
import { StockFinder } from "./_components/stock-finder";

/**
 * Find stock: type a material, see whether there is any free to use and which
 * rack it is on — "Rack 10, row 3" — so someone can walk straight to it.
 * `?q=` opens with a search already run, for links from elsewhere.
 */
export default async function FindStockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAnyPermission([PERMISSIONS.STOCK_VIEW, PERMISSIONS.STOCK_CREATE]);
  const [{ categories, locations }, params] = await Promise.all([
    getFindStockFilters(),
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
      />
    </div>
  );
}
