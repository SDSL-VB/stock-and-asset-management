import { requireAnyPermission } from "@/lib/rbac/check";
import {
  PERMISSIONS,
  STOCK_ENTRIES_PAGE_PERMISSIONS,
} from "@/lib/rbac/permissions";
import { getStockEntryById, getAttachmentTypeConfigs } from "@/lib/actions/stock";
import { getDepartmentsForSelect } from "@/lib/actions/users";
import { notFound } from "next/navigation";
import { StockEntryDetail } from "../_components/stock-entry-detail";

export default async function StockEntryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAnyPermission(STOCK_ENTRIES_PAGE_PERMISSIONS);
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
      // Only departments a move from this entry may go to: its own site, unless
      // this person may move across sites (the server checks the same)
      departments={departments.filter(
        (d) =>
          // Never into central stock itself
          !d.isCentralStock &&
          (user.permissions.includes(PERMISSIONS.ASSETS_MOVE_CROSS_SITE) ||
            (d.locationId !== null && d.locationId === entry.locationId))
      )}
    />
  );
}
