"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { logActivity } from "@/lib/activity-log";
import { APPROVAL_FLOWS } from "@/lib/approval-catalog";

/**
 * The Approval Flows page: every approval (see approval-catalog.ts) with the
 * permission that decides it, the roles holding that permission right now,
 * and the two switches — bill-of-materials review and verifying needs.
 */

export async function getApprovalFlows() {
  await requirePermission(PERMISSIONS.APPROVALS_CONFIGURE);

  const keys = [...new Set(APPROVAL_FLOWS.flatMap((f) => f.steps.flatMap((s) => s.permissions)))];
  const [permissions, bom, needs] = await Promise.all([
    prisma.permission.findMany({
      where: { key: { in: keys } },
      select: { key: true, name: true, roles: { select: { role: { select: { name: true } } } } },
    }),
    prisma.bomFlowConfig.findUnique({ where: { id: "singleton" }, select: { requiresApproval: true } }),
    prisma.procurementFlowConfig.findUnique({ where: { id: "singleton" }, select: { requiresApproval: true } }),
  ]);
  const byKey = new Map(permissions.map((p) => [p.key, p]));

  return {
    switches: { bom: bom?.requiresApproval ?? true, needs: needs?.requiresApproval ?? true },
    flows: APPROVAL_FLOWS.map((flow) => ({
      ...flow,
      steps: flow.steps.map((step) => ({
        label: step.label,
        reach: step.reach,
        deciders: step.permissions.map((key) => ({
          key,
          name: byKey.get(key)?.name ?? key,
          roles: (byKey.get(key)?.roles ?? []).map((r) => r.role.name).sort(),
        })),
      })),
    })),
  };
}

const switchSchema = z.object({ which: z.enum(["bom", "needs"]), on: z.boolean() });

/** Turn bill-of-materials review or verifying needs on or off. */
export async function setApprovalSwitch(data: unknown) {
  const user = await requirePermission(PERMISSIONS.APPROVALS_CONFIGURE);
  const parsed = switchSchema.safeParse(data);
  if (!parsed.success) return { error: "Unknown setting" };
  const { which, on } = parsed.data;

  const values = { requiresApproval: on, updatedById: user.id };
  if (which === "bom") {
    await prisma.bomFlowConfig.upsert({ where: { id: "singleton" }, update: values, create: { id: "singleton", ...values } });
  } else {
    await prisma.procurementFlowConfig.upsert({ where: { id: "singleton" }, update: values, create: { id: "singleton", ...values } });
  }
  const label = which === "bom" ? "Bill-of-materials review" : "Verifying needs before ordering";
  await logActivity("UPDATED", "ApprovalFlow", which, `${label} turned ${on ? "on" : "off"}`);
  revalidatePath("/approvals");
  revalidatePath("/bom");
  revalidatePath("/procurement");
  return { success: true };
}
