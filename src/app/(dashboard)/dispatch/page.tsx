import { requireAnyPermission } from "@/lib/rbac/check";
import {
  PERMISSIONS,
  DISPATCH_PERMISSIONS,
  DISPATCH_PAGE_PERMISSIONS,
} from "@/lib/rbac/permissions";
import { getSiteRequests } from "@/lib/actions/fulfilment";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SiteRequestList } from "./_components/site-request-list";
import { getDispatches, getDispatchableStock } from "@/lib/actions/dispatch";
import { getLocationsForSelect, getMyLocationId } from "@/lib/actions/locations";
import { getClientsForDispatch } from "@/lib/actions/clients";
import { PageHeader } from "@/components/shared/page-header";
import { HowTo } from "@/components/shared/how-to";
import { DispatchManager } from "./_components/dispatch-manager";

/**
 * Goods leaving: consignments, and one site asking another for stock.
 *
 * Two tabs, each shown only to those who can use it:
 *
 *   Consignments   everything leaving a site, to another site or to a client
 *   Site requests  one site asking another for stock. Accepting one raises a
 *                  consignment, which is why they live here. This was half of
 *                  the old Fulfilment page (the planning half is on Builds).
 *
 * Engineers and managers ask for stock but hold no dispatch key, so they open
 * this page through the fulfilment keys and see only Site requests — which is
 * where they follow what they asked for. `?tab=requests` opens that tab.
 */
export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAnyPermission(DISPATCH_PAGE_PERMISSIONS);
  const has = (p: string) => user.permissions.includes(p);

  const canCreate = has(PERMISSIONS.DISPATCH_CREATE);
  // Each half loads only for those who hold its keys: the dispatch actions
  // redirect anyone without one, which would bounce an engineer off the page.
  const canSeeConsignments = DISPATCH_PERMISSIONS.some(has);
  const canSeeRequests = has(PERMISSIONS.FULFILMENT_VIEW);

  const [dispatches, stock, locations, clients, myLocationId, requests] = await Promise.all([
    canSeeConsignments ? getDispatches() : Promise.resolve([]),
    canCreate ? getDispatchableStock(undefined) : Promise.resolve([]),
    canSeeConsignments ? getLocationsForSelect() : Promise.resolve([]),
    canCreate ? getClientsForDispatch() : Promise.resolve([]),
    canSeeConsignments ? getMyLocationId() : Promise.resolve(null),
    canSeeRequests ? getSiteRequests() : Promise.resolve(null),
  ]);

  const requested = (await searchParams).tab;
  const tab =
    requested === "requests" && canSeeRequests ? "requests" : canSeeConsignments ? "consignments" : "requests";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dispatch"
        description="Outgoing stock and assets — between our locations, and out to clients"
      >
        <HowTo
          title="How a dispatch works"
          intro="Everything that leaves a site goes out as a dispatch, and every line is stamped with a batch number."
          sections={[
            {
              steps: [
                { title: "Raise it", description: "Pick items from your site's central stock and send them either to another location or to a client. The quantity leaves your central stock straight away." },
                { title: "The other end accepts", description: "A location-to-location consignment waits for the receiving operator to accept it. Until then both sites show it as pending." },
                { title: "Mark it received", description: "Once it arrives, confirming receipt books the stock in as central stock at the destination." },
                { title: "Batch numbers are the recall handle", description: "Look one up to find the client who received that item, with their address and GST details." },
              ],
            },
          ]}
        />
      </PageHeader>
      <Tabs defaultValue={tab} className="space-y-4">
        {canSeeConsignments && canSeeRequests && (
          <TabsList>
            <TabsTrigger value="consignments">Consignments</TabsTrigger>
            <TabsTrigger value="requests">Site requests</TabsTrigger>
          </TabsList>
        )}
        {canSeeConsignments && (
          <TabsContent value="consignments">
            <DispatchManager
              dispatches={dispatches}
              stock={stock}
              locations={locations}
              clients={clients}
              myLocationId={myLocationId}
              canCreate={canCreate}
              canAccept={has(PERMISSIONS.DISPATCH_ACCEPT)}
              canReceive={has(PERMISSIONS.DISPATCH_RECEIVE)}
              seesAllLocations={has(PERMISSIONS.STOCK_SCOPE_ALL)}
              canExport={has(PERMISSIONS.DISPATCH_EXPORT)}
            />
          </TabsContent>
        )}
        {canSeeRequests && requests && (
          <TabsContent value="requests">
            <SiteRequestList {...requests} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
