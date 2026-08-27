import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, FULFILMENT_PERMISSIONS } from "@/lib/rbac/permissions";
import {
  getFulfilmentProducts,
  getSiteRequests,
  getRequestDestinations,
} from "@/lib/actions/fulfilment";
import { PageHeader } from "@/components/shared/page-header";
import { HowTo } from "@/components/shared/how-to";
import { FulfilmentPlanner } from "./_components/fulfilment-planner";
import { SiteRequestList } from "./_components/site-request-list";

export default async function FulfilmentPage() {
  const user = await requireAnyPermission(FULFILMENT_PERMISSIONS);

  // Each call is guarded by the key it actually needs. Fetching unconditionally
  // is how the Access Denied bugs happened before: a failed permission check
  // redirects, so one ungated call takes down the whole page for someone who
  // was allowed to see most of it.
  const canView = user.permissions.includes(PERMISSIONS.FULFILMENT_VIEW);
  const canRequest = user.permissions.includes(PERMISSIONS.FULFILMENT_REQUEST);

  const [products, requests, destinations] = await Promise.all([
    canView ? getFulfilmentProducts() : Promise.resolve([]),
    canView ? getSiteRequests() : Promise.resolve(null),
    canRequest ? getRequestDestinations() : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fulfilment"
        description="Whether we can meet an order, from which site, and what would have to move"
      >
        <HowTo
          title="How fulfilment works"
          intro="This answers one question — can we supply this, and from where — by reading current stock across every site. Nothing here is stored; it is the position as it stands right now."
          sections={[
            {
              steps: [
                {
                  title: "Stock on the shelf comes first",
                  description:
                    "Only uncommitted central stock counts. Anything already issued to a department, promised to a build, or on a consignment is not offered twice.",
                },
                {
                  title: "Then what could be made",
                  description:
                    "For anything with a published bill of materials, each site is also checked for the components to build more, one level deep — a sub-assembly has to exist before it can go into something else.",
                },
                {
                  title: "Then the shortfall",
                  description:
                    "If stock and building together still fall short, the gap is stated plainly rather than rounded away, so it can be bought or scheduled.",
                },
                {
                  title: "Asking another site",
                  description:
                    "Where another site is holding what you need, you can ask for it. If they agree, an ordinary dispatch is raised and travels the normal route — so it is tracked, batched and received like anything else.",
                },
              ],
            },
          ]}
        />
      </PageHeader>

      {canView && (
        <>
          <FulfilmentPlanner
            products={products}
            canRequest={canRequest}
            destinations={destinations}
          />
          {requests && <SiteRequestList {...requests} />}
        </>
      )}
    </div>
  );
}
