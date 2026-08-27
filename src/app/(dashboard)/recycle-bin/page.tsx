import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, RECYCLE_BIN_PERMISSIONS } from "@/lib/rbac/permissions";
import { getRecycleBin } from "@/lib/actions/recycle-bin";
import { RECYCLE_BIN_DAYS } from "@/lib/recycle-bin";
import { PageHeader } from "@/components/shared/page-header";
import { RecycleBinList } from "./_components/recycle-bin-list";

export default async function RecycleBinPage() {
  const user = await requireAnyPermission(RECYCLE_BIN_PERMISSIONS);
  const records = await getRecycleBin();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recycle bin"
        description={`Anything deleted in the last ${RECYCLE_BIN_DAYS} days, and how to put it back`}
      />
      <RecycleBinList
        records={records}
        canRestore={user.permissions.includes(PERMISSIONS.RECYCLEBIN_RESTORE)}
        canPurge={user.permissions.includes(PERMISSIONS.RECYCLEBIN_PURGE)}
      />
    </div>
  );
}
