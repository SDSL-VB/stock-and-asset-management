import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getBuilds, getBuildLocations } from "@/lib/actions/builds";
import { PageHeader } from "@/components/shared/page-header";
import { HowTo } from "@/components/shared/how-to";
import { BuildList } from "./_components/build-list";
import { NewBuildDialog } from "./_components/new-build-dialog";

export default async function BuildsPage() {
  const user = await requireAnyPermission([
    PERMISSIONS.BOM_VIEW,
    PERMISSIONS.BOM_BUILD,
    PERMISSIONS.BOM_UNBUILD,
  ]);

  const canBuild = user.permissions.includes(PERMISSIONS.BOM_BUILD);
  const [builds, locations] = await Promise.all([
    getBuilds(),
    canBuild ? getBuildLocations() : Promise.resolve([]),
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
        canReverse={user.permissions.includes(PERMISSIONS.BOM_UNBUILD)}
        canFinish={user.permissions.includes(PERMISSIONS.BOM_BUILD_FINISH)}
        canSetBatch={user.permissions.includes(PERMISSIONS.STOCK_BATCH_EDIT)}
      />
    </div>
  );
}
