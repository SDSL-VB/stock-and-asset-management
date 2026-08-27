import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getStockEntryById, getAttachmentTypeConfigs } from "@/lib/actions/stock";
import { getDepartmentsForSelect } from "@/lib/actions/users";
import { notFound } from "next/navigation";
import { StockEntryDetail } from "../_components/stock-entry-detail";

export default async function StockEntryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAnyPermission([PERMISSIONS.STOCK_VIEW, PERMISSIONS.STOCK_CREATE]);
  const { id } = await params;
  const [entry, attachmentTypes, departments] = await Promise.all([
    getStockEntryById(id),
    getAttachmentTypeConfigs(),
    getDepartmentsForSelect(),
  ]);

  if (!entry) notFound();

  return (
    <StockEntryDetail
      entry={entry}
      userPermissions={user.permissions}
      userId={user.id}
      userDepartmentId={user.departmentId ?? undefined}
      attachmentTypes={attachmentTypes}
      departments={departments}
    />
  );
}
