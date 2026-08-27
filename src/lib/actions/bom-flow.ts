"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { logActivity } from "./activity";
import { revalidatePath } from "next/cache";

/**
 * How a bill of materials becomes the version in force.
 *
 * One rule for the whole company, deliberately — a bill of materials describes
 * a product, and a product does not belong to a department the way a stock
 * entry does. The stock approval flow stays per-department for exactly the
 * opposite reason.
 *
 * A single row, created the first time it is read.
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

export async function saveBomFlow(data: { requiresApproval: boolean; approverRoleId: string }) {
  const user = await requirePermission(PERMISSIONS.CONFIG_FLOWS_BOM);

  const approverRoleId = data.approverRoleId || null;

  if (approverRoleId) {
    const role = await prisma.role.findUnique({
      where: { id: approverRoleId },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) return { error: "That role does not exist" };

    // Naming a role that cannot approve would produce a queue nobody can clear
    const canApprove = role.permissions.some(
      (rp) => rp.permission.key === PERMISSIONS.BOM_APPROVE
    );
    if (!canApprove) {
      return {
        error: `${role.name} does not hold "bom.approve", so nobody in that role could clear the queue. Grant it on the Roles page first.`,
      };
    }
  }

  await prisma.bomFlowConfig.upsert({
    where: { id: SINGLETON },
    update: { requiresApproval: data.requiresApproval, approverRoleId, updatedById: user.id },
    create: {
      id: SINGLETON,
      requiresApproval: data.requiresApproval,
      approverRoleId,
      updatedById: user.id,
    },
  });

  await logActivity(
    "UPDATED",
    "BomFlowConfig",
    SINGLETON,
    data.requiresApproval
      ? `Bills of materials now need approval${approverRoleId ? " from a named role" : " from anyone who can approve"}`
      : "Bills of materials now publish without approval"
  );

  revalidatePath("/configure");
  revalidatePath("/bom");
  return { success: true };
}
