import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, BUILDS_PAGE_PERMISSIONS } from "@/lib/rbac/permissions";
import { getBuilds, getBuildLocations } from "@/lib/actions/builds";
import { getIntentFormData } from "@/lib/actions/procurement";
import { getFulfilmentProducts, getRequestDestinations } from "@/lib/actions/fulfilment";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FulfilmentPlanner } from "./_components/fulfilment-planner";
import { PageHeader } from "@/components/shared/page-header";
import { HowTo } from "@/components/shared/how-to";
import { BuildList } from "./_components/build-list";
import { NewBuildDialog } from "./_components/new-build-dialog";

/**
 * Making things: the runs themselves, and planning whether an order can be met.
 *
 * Two tabs, each shown only to those who can use it:
 *
 *   Runs  what has been built, what is on the floor, and starting a new run
 *   Plan  "can we meet an order of N, and from where?" — what each site holds,
 *         what it could build from components on hand, and what is still short.
 *         This was the Fulfilment page; it lives beside the builds it plans.
 *
 * `?tab=plan` opens the second tab, which is where links to the old Fulfilment
 * page now land.
 */
export default async function BuildsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAnyPermission(BUILDS_PAGE_PERMISSIONS);
  const has = (p: string) => user.permissions.includes(p);

  const canBuild = has(PERMISSIONS.BOM_BUILD);
  // The runs list reads bill-of-materials data, so it needs one of these keys;
  // someone holding only fulfilment.view sees the Plan tab alone.
  const canSeeRuns = has(PERMISSIONS.BOM_VIEW) || canBuild || has(PERMISSIONS.BOM_UNBUILD);
  const canPlan = has(PERMISSIONS.FULFILMENT_VIEW);
  const canAskOtherSite = has(PERMISSIONS.FULFILMENT_REQUEST);

  // Holders of intent.create can turn a short build straight into needs
  const canRequestNeeds = canBuild && has(PERMISSIONS.PROCUREMENT_INTENT_CREATE);

  const [builds, locations, planProducts, destinations, needForm] = await Promise.all([
    canSeeRuns ? getBuilds() : Promise.resolve([]),
    canBuild ? getBuildLocations() : Promise.resolve([]),
    canPlan ? getFulfilmentProducts() : Promise.resolve([]),
    canAskOtherSite ? getRequestDestinations() : Promise.resolve([]),
    canRequestNeeds ? getIntentFormData() : Promise.resolve(null),
  ]);

  const requested = (await searchParams).tab;
  const tab = requested === "plan" && canPlan ? "plan" : canSeeRuns ? "runs" : "plan";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Builds"
        description="Everything made from a bill of materials, and what each one consumed"
      >
        {canBuild && (
          <NewBuildDialog
            locations={locations}
            canSetBatch={user.permissions.includes(PERMISSIONS.STOCK_BATCH_EDIT)}
            needForm={needForm}
          />
        )}
        <HowTo
          title="How building works"
          intro="A build turns components into the thing they make. It is the step between a bill of materials and something you can dispatch."
          sections={[
            {
              steps: [
                {
                  title: "Components genuinely leave",
                  description:
                    "Building 3 PCs takes 3 monitors, 3 keyboards and 3 mice out of central stock. Whatever is left over still shows as itself.",
                },
                {
                  title: "The product genuinely arrives",
                  description:
                    "A new central stock entry appears for the assembled product, carrying the build number as its batch. Dispatch treats it like anything else.",
                },
                {
                  title: "Oldest stock goes first",
                  description:
                    "When several entries could supply a component, the earliest is drawn down first, so stock rotates instead of ageing at the back.",
                },
                {
                  title: "Recall traces straight through",
                  description:
                    "Each build records exactly which entries it consumed, so a faulty component batch leads to the builds that used it, and on to the clients who received them.",
                },
              ],
            },
          ]}
        />
      </PageHeader>
      <Tabs defaultValue={tab} className="space-y-4">
        {/* The tab strip only appears when there is a choice to make */}
        {canSeeRuns && canPlan && (
          <TabsList>
            <TabsTrigger value="runs">Runs</TabsTrigger>
            <TabsTrigger value="plan">Plan</TabsTrigger>
          </TabsList>
        )}
        {canSeeRuns && (
          <TabsContent value="runs">
            <BuildList
              builds={builds}
              canReverse={has(PERMISSIONS.BOM_UNBUILD)}
              canFinish={has(PERMISSIONS.BOM_BUILD_FINISH)}
              canSetBatch={has(PERMISSIONS.STOCK_BATCH_EDIT)}
            />
          </TabsContent>
        )}
        {canPlan && (
          <TabsContent value="plan">
            <FulfilmentPlanner
              products={planProducts}
              canRequest={canAskOtherSite}
              destinations={destinations}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
