import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  getStockSummaryStats,
  getInventoryOverview,
  getWorkInProgress,
  exportStockReport,
} from "@/lib/actions/reports";
import { getDepartmentsForSelect } from "@/lib/actions/users";
import { PageHeader } from "@/components/shared/page-header";
import { ExportButton } from "@/components/shared/export-button";
import { StockReports } from "./_components/stock-reports";
import { WorkInProgressCard } from "./_components/work-in-progress-card";

export default async function ReportsPage() {
  const user = await requirePermission(PERMISSIONS.REPORTS_VIEW);

  const [summaryStats, departments, inventoryOverview, wip] = await Promise.all([
    getStockSummaryStats(),
    getDepartmentsForSelect(),
    getInventoryOverview(),
    getWorkInProgress(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Reports & Inventory"
        description="Inventory overview, stock analytics, and exportable reports"
      >
        {/* Taking the whole report away as a file is its own permission. The
            action existed but nothing on the page ever called it, so anyone
            granted reports.export had no way to use it. */}
        {user.permissions.includes(PERMISSIONS.REPORTS_EXPORT) && (
          <ExportButton
            action={exportStockReport}
            fileName="stock-report"
            noun="entry"
            label="Export report"
          />
        )}
      </PageHeader>
      <WorkInProgressCard
        rows={wip.rows}
        totalOnFloor={wip.totalOnFloor}
        tiedUpValue={wip.tiedUpValue}
      />
      <StockReports
        summaryStats={summaryStats}
        departments={departments}
        userPermissions={user.permissions}
        inventoryOverview={inventoryOverview}
      />
    </div>
  );
}
