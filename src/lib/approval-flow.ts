import { prisma } from "@/lib/prisma";

export const NO_FLOW_CONFIGURED = "No approval flow configured. Contact an administrator.";

/**
 * The approval flow that governs an entry: its department's own, or the
 * company default. Returns null when there is nothing usable to snapshot.
 *
 * Shared by submitting and by rebuilding a lost snapshot, so the two can never
 * disagree about which steps an entry should have.
 *
 * Worth knowing: the steps are copied onto the entry as VALUES, not as links to
 * this flow. Editing the flow afterwards therefore never changes an entry that
 * is already in flight — which is deliberate, and also why changing the flow
 * cannot rescue an entry whose snapshot is missing. Rebuilding it can.
 */
export async function findApprovalFlow(departmentId: string | null) {
  const flow = await prisma.approvalFlowConfig.findFirst({
    where: {
      isActive: true,
      OR: [{ departmentId }, { departmentId: null }],
    },
    include: { steps: { orderBy: { stepOrder: "asc" } } },
    // Prefer a department's own flow over the company default. `nulls: "last"`
    // is what makes that true: Postgres puts NULLs FIRST on a plain DESC, so
    // the default flow used to win and a department's own flow was ignored.
    orderBy: { departmentId: { sort: "desc", nulls: "last" } },
  });

  return flow && flow.steps.length > 0 ? flow : null;
}
