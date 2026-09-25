import { requireAnyPermission } from "@/lib/rbac/check";
import {
  PERMISSIONS,
  WASTAGE_PAGE_PERMISSIONS,
  WRITE_OFF_RAISE_PERMISSIONS,
} from "@/lib/rbac/permissions";
import { getWastageSummary } from "@/lib/actions/write-offs";
import { PageHeader } from "@/components/shared/page-header";
import { HowTo } from "@/components/shared/how-to";
import { WastageBoard } from "./_components/wastage-board";
import { RecordWastageDialog } from "./_components/record-wastage-dialog";

/**
 * Stock that stopped being stock: damaged, lost, expired, obsolete.
 *
 * Two halves of one idea, exactly like the Assets page. The queue is what still
 * needs deciding; the history is what has already been lost, and to what.
 *
 * Reached by anyone holding stock.writeoff.view OR stock.writeoff.approve — a
 * manager whose only job here is signing things off still needs the way in.
 * Keep this list, `middleware.ts` and WASTAGE_PAGE_PERMISSIONS in step.
 */
export default async function WastagePage() {
  const user = await requireAnyPermission(WASTAGE_PAGE_PERMISSIONS);

  const summary = await getWastageSummary();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wastage"
        description="Stock reported unusable, what a manager decided, and what it cost"
      >
        {/* Reporting a loss starts here too, not only from the stock entry it
            came off — this is the page people open when something breaks. */}
        {WRITE_OFF_RAISE_PERMISSIONS.some((p) => user.permissions.includes(p)) && <RecordWastageDialog />}
        <HowTo
          title="How a write-off works"
          intro="Nothing leaves stock until a manager agrees it should."
          sections={[
            {
              steps: [
                {
                  title: "Someone reports it",
                  description:
                    "A quantity, a reason, and a note saying what happened — from \"Report wastage\" here, from the stock entry, or from what a department holds.",
                },
                {
                  title: "It is frozen, not removed",
                  description:
                    "A pending write-off stays counted as held, because the goods are still on the shelf. But nobody can dispatch it, transfer it or build with it while the decision is open.",
                },
                {
                  title: "A manager decides",
                  description:
                    "Approving is what actually removes the stock. Declining releases it back, with a reason the reporter can read.",
                },
                {
                  title: "Mistakes can be undone",
                  description:
                    "An approval made in error can be reversed, which puts the stock back. The record stays visible as reversed rather than disappearing.",
                },
              ],
            },
          ]}
        />
      </PageHeader>

      <WastageBoard
        summary={summary}
        canSeeValue={user.permissions.includes(PERMISSIONS.STOCK_VALUE_VIEW)}
      />
    </div>
  );
}
