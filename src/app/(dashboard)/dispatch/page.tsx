import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, DISPATCH_PERMISSIONS } from "@/lib/rbac/permissions";
import { getDispatches, getDispatchableStock } from "@/lib/actions/dispatch";
import { getLocationsForSelect, getMyLocationId } from "@/lib/actions/locations";
import { getClientsForDispatch } from "@/lib/actions/clients";
import { PageHeader } from "@/components/shared/page-header";
import { HowTo } from "@/components/shared/how-to";
import { DispatchManager } from "./_components/dispatch-manager";

export default async function DispatchPage() {
  const user = await requireAnyPermission(DISPATCH_PERMISSIONS);
  const has = (p: string) => user.permissions.includes(p);

  const canCreate = has(PERMISSIONS.DISPATCH_CREATE);

  const [dispatches, stock, locations, clients, myLocationId] = await Promise.all([
    getDispatches(),
    canCreate ? getDispatchableStock(undefined) : Promise.resolve([]),
    getLocationsForSelect(),
    canCreate ? getClientsForDispatch() : Promise.resolve([]),
    getMyLocationId(),
  ]);

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
    </div>
  );
}
