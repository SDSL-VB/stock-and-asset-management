import { prisma } from "@/lib/prisma";

/**
 * How a bill of materials becomes the version in force.
 *
 * One rule for the whole company, deliberately — a bill of materials describes
 * a product, and a product does not belong to a department the way a stock
 * entry does. The stock approval flow stays per-department for exactly the
 * opposite reason.
 *
 * A single row, created the first time it is read. A plain server module, not
 * a "use server" one, so it is not a callable endpoint. Read by bom.ts when a
 * bill of materials is submitted; switched on or off on the Approval Flows page
 * (actions/approval-settings.ts).
 */

const SINGLETON = "singleton";

export async function getBomFlow() {
  const existing = await prisma.bomFlowConfig.findUnique({
    where: { id: SINGLETON },
    include: { approverRole: { select: { id: true, name: true } } },
  });
  if (existing) return existing;

  return prisma.bomFlowConfig.create({
    data: { id: SINGLETON },
    include: { approverRole: { select: { id: true, name: true } } },
  });
}

