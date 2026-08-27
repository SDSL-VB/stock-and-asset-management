import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getStockEntries, getStockEntryStats } from "@/lib/actions/stock";
import { PageHeader } from "@/components/shared/page-header";
import { StockEntryList } from "./_components/stock-entry-list";
import { Button } from "@/components/ui/button";
import { HowTo } from "@/components/shared/how-to";
import { Plus } from "lucide-react";
import Link from "next/link";
import { hasPermission } from "@/lib/rbac/check";

/**
 * The filters live in the URL, so a filtered view can be sent to somebody —
 * "/stock?site=loc_hyderabad&source=TRANSFERRED" is a shareable question. They
 * are read here and handed to the list as its starting state; the list keeps
 * the URL in step as they change.
 */
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAnyPermission([PERMISSIONS.STOCK_VIEW, PERMISSIONS.STOCK_CREATE]);
  const [entries, stats, params] = await Promise.all([
    getStockEntries(),
    getStockEntryStats(),
    searchParams,
  ]);

  /** One value, or the first if a key somehow arrives twice. */
  const one = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? undefined;
  };

  const canCreate = hasPermission(user.permissions, PERMISSIONS.STOCK_CREATE);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Stock Entries"
        description="Manage incoming stock entries and track approvals"
      >
        <HowTo
          title="How stock entries work"
          intro="Every entry follows the same lifecycle from goods received to a department."
          sections={[
            {
              steps: [
                { title: "Create the entry", description: "Pick the product from the catalog, enter supplier, quantity, price, and the location where stock was received." },
                { title: "Attach documents & submit", description: "Upload the required documents (e.g. invoice) and submit for approval." },
                { title: "Approval", description: "Approvers work through the configured steps. Rejected entries can be edited and resubmitted." },
                { title: "Stock lands in central stock", description: "Approved quantity sits in central stock for its location until it is moved." },
                { title: "Move to a department", description: "Managers move stock directly; operators raise a transfer request that the receiving department's manager approves." },
              ],
            },
          ]}
        />
        {canCreate && (
          <Link href="/stock/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Stock Entry
            </Button>
          </Link>
        )}
      </PageHeader>

      <StockEntryList
        entries={entries}
        stats={stats}
        canSeeWarranty={user.permissions.includes(PERMISSIONS.STOCK_WARRANTY_VIEW)}
        canSeeValue={hasPermission(user.permissions, PERMISSIONS.STOCK_VALUE_VIEW)}
        initialFilters={{
          status: one("status"),
          source: one("source"),
          kind: one("kind"),
          category: one("category"),
          site: one("site"),
          holding: one("holding"),
        }}
      />
    </div>
  );
}
