import { requireAnyPermission } from "@/lib/rbac/check";
import {
  PERMISSIONS,
  ASSET_PAGE_PERMISSIONS,
  resolveStockScope,
} from "@/lib/rbac/permissions";
import {
  getAssetHoldings,
  getCentralStockForAssets,
  getTransferRequests,
  getTransferableEntries,
} from "@/lib/actions/assets";
import { getDepartmentsForSelect } from "@/lib/actions/users";
import { PageHeader } from "@/components/shared/page-header";
import { HowTo } from "@/components/shared/how-to";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssetList } from "./_components/asset-list";
import { NewAssetDialog } from "./_components/new-asset-dialog";
import { RequestTransferPickerDialog } from "./_components/request-transfer-dialog";
import { TransferQueue } from "./_components/transfer-queue";

/**
 * What each department holds, and how things get there.
 *
 * Two tabs, because they are the two halves of one idea: Holdings is the
 * result, Transfers is the act. Both are absent unless the viewer holds the
 * matching key, so a person who can only ask for a transfer sees one tab.
 */
export default async function AssetsPage() {
  const user = await requireAnyPermission(ASSET_PAGE_PERMISSIONS);
  const has = (p: string) => user.permissions.includes(p);

  const canSeeHoldings = has(PERMISSIONS.ASSETS_VIEW);
  const canRequestTransfer = has(PERMISSIONS.ASSETS_TRANSFER_REQUEST);
  const canApproveTransfer = has(PERMISSIONS.ASSETS_TRANSFER_APPROVE);
  const canSeeTransfers = canRequestTransfer || canApproveTransfer;

  // Creating an asset is its own capability AND a stock movement, so it needs
  // both keys. Requiring both is what keeps the button from appearing to
  // someone the underlying action would refuse.
  const canCreateAsset = has(PERMISSIONS.ASSETS_CREATE) && has(PERMISSIONS.STOCK_MOVE);

  const [assets, centralStock, departments, transfers, transferable] = await Promise.all([
    canSeeHoldings ? getAssetHoldings() : Promise.resolve([]),
    canCreateAsset ? getCentralStockForAssets() : Promise.resolve([]),
    canCreateAsset || canRequestTransfer ? getDepartmentsForSelect() : Promise.resolve([]),
    canSeeTransfers ? getTransferRequests() : Promise.resolve([]),
    canRequestTransfer ? getTransferableEntries() : Promise.resolve([]),
  ]);

  const pending = transfers.filter((t) => t.status === "PENDING").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assets"
        description="What each department holds, and the transfers that put it there"
      >
        {canCreateAsset && <NewAssetDialog entries={centralStock} departments={departments} />}
        {canRequestTransfer && (
          <RequestTransferPickerDialog entries={transferable} departments={departments} />
        )}
        <HowTo
          title="How something becomes a department's"
          intro="Assets are not a separate catalog — they are stock that was moved into a department."
          sections={[
            {
              steps: [
                {
                  title: "Everything lands in central stock first",
                  description: "Received stock is plain stock, whatever it is.",
                },
                {
                  title: "The movement decides",
                  description:
                    "Move central stock into a department as an asset, or ask for it and let the department's manager agree.",
                },
                {
                  title: "Approving a transfer IS the movement",
                  description:
                    "There is no second step: the quantity leaves central stock the moment the request is approved.",
                },
              ],
            },
          ]}
        />
      </PageHeader>

      <Tabs defaultValue={canSeeHoldings ? "holdings" : "transfers"}>
        <TabsList>
          {canSeeHoldings && <TabsTrigger value="holdings">Holdings</TabsTrigger>}
          {canSeeTransfers && (
            <TabsTrigger value="transfers">
              Transfers {pending > 0 && `(${pending})`}
            </TabsTrigger>
          )}
        </TabsList>

        {canSeeHoldings && (
          <TabsContent value="holdings">
            <AssetList assets={assets} canSeeValue={has(PERMISSIONS.STOCK_VALUE_VIEW)} />
          </TabsContent>
        )}

        {canSeeTransfers && (
          <TabsContent value="transfers">
            <TransferQueue
              requests={transfers}
              canApprove={canApproveTransfer}
              seesEverySite={resolveStockScope(user) === "all"}
              viewerDepartmentId={user.departmentId ?? null}
              viewerId={user.id}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
