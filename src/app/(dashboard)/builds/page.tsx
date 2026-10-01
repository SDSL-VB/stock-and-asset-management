import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, BUILDS_PAGE_PERMISSIONS } from "@/lib/rbac/permissions";
import { getBuilds, getBuildLocations } from "@/lib/actions/builds";
import { getIntentFormData } from "@/lib/actions/procurement";
import { PageHeader } from "@/components/shared/page-header";
import { HowTo } from "@/components/shared/how-to";
import { BuildList } from "./_components/build-list";
import { NewBuildDialog } from "./_components/new-build-dialog";

/**
 * Making things: what has been built, what is on the floor, and starting a new
 * run. Opened by builds.view or a key that acts on a run — see
 * BUILDS_PAGE_PERMISSIONS. Planning an order lives on the Fulfilment page.
 */
export default async function BuildsPage() {
  const user = await requireAnyPermission(BUILDS_PAGE_PERMISSIONS);
  const has = (p: string) => user.permissions.includes(p);

  const canBuild = has(PERMISSIONS.BOM_BUILD);

  // Holders of intent.create can turn a short build straight into needs
  const canRequestNeeds = canBuild && has(PERMISSIONS.PROCUREMENT_INTENT_CREATE);

  const [builds, locations, needForm] = await Promise.all([
    getBuilds(),
    canBuild ? getBuildLocations() : Promise.resolve([]),
    canRequestNeeds ? getIntentFormData() : Promise.resolve(null),
  ]);

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
            canRequestMaterials={user.permissions.includes(PERMISSIONS.MATERIALS_REQUEST)}
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
      <BuildList
        builds={builds}
        canReverse={has(PERMISSIONS.BOM_UNBUILD)}
        canFinish={has(PERMISSIONS.BOM_BUILD_FINISH)}
        canSetBatch={has(PERMISSIONS.STOCK_BATCH_EDIT)}
      />
    </div>
  );
}
