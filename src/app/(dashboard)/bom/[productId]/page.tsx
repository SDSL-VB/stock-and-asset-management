import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, BOM_PERMISSIONS } from "@/lib/rbac/permissions";
import { getBomWorkbench, getExpandedBom } from "@/lib/actions/bom";
import { getBuildLocations } from "@/lib/actions/builds";
import { BomWorkbench } from "./_components/bom-workbench";

export default async function BomDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const user = await requireAnyPermission(BOM_PERMISSIONS);
  const has = (p: string) => user.permissions.includes(p);

  const workbench = await getBomWorkbench(productId);
  if (!workbench) notFound();

  const canBuild = has(PERMISSIONS.BOM_BUILD);

  const [expanded, locations] = await Promise.all([
    getExpandedBom(productId, 1),
    // Gated on bom.build, so only ask for it when the viewer holds it
    canBuild ? getBuildLocations() : Promise.resolve([]),
  ]);

  return (
    <BomWorkbench
      product={workbench.product}
      versions={workbench.versions}
      components={workbench.components}
      expanded={expanded}
      locations={locations}
      currentUserId={user.id}
      canCreate={has(PERMISSIONS.BOM_CREATE)}
      canEdit={has(PERMISSIONS.BOM_EDIT)}
      canPublish={has(PERMISSIONS.BOM_PUBLISH)}
      canApprove={has(PERMISSIONS.BOM_APPROVE)}
      viewerDepartmentId={user.departmentId ?? null}
      canDelete={has(PERMISSIONS.BOM_DELETE)}
      canBuild={canBuild}
      canSetBatch={has(PERMISSIONS.STOCK_BATCH_EDIT)}
      canEditProduct={has(PERMISSIONS.PRODUCTS_EDIT)}
      canSeeValue={has(PERMISSIONS.STOCK_VALUE_VIEW)}
    />
  );
}
