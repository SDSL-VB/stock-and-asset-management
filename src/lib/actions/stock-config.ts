"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fieldConfigSchema,
  attachmentTypeSchema,
  approvalFlowSchema,
  approvalFlowStepSchema,
} from "@/lib/validations/stock-config";
import { logActivity } from "./activity";
import { revalidatePath } from "next/cache";

/**
 * The configurable parts of a stock entry: its extra fields, the document types
 * it can carry, and the approval flow a submitted entry follows.
 *
 * Called by: the Configuration page, and the stock entry form (which reads the
 * field and attachment configuration to know what to render and what to insist
 * on before submitting).
 *
 * Worth knowing about the flow: a step names the role EXPECTED to approve, but
 * who is actually ALLOWED to is decided by `stock.approve` plus the site the
 * goods arrived at. Keeping those apart is what stops a step naming a role
 * nobody holds from blocking every approval in the system.
 */

// =====================
// Field Configs
// =====================

export async function getFieldConfigs() {
  await requirePermission(PERMISSIONS.STOCK_CONFIG_FIELDS);
  return prisma.stockEntryFieldConfig.findMany({
    orderBy: { displayOrder: "asc" },
  });
}

export async function createFieldConfig(data: unknown) {
  await requirePermission(PERMISSIONS.STOCK_CONFIG_FIELDS);

  const parsed = fieldConfigSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const existing = await prisma.stockEntryFieldConfig.findUnique({
    where: { fieldName: parsed.data.fieldName },
  });
  if (existing) return { error: "A field with this name already exists" };

  const config = await prisma.stockEntryFieldConfig.create({
    data: {
      ...parsed.data,
      options: parsed.data.options ?? undefined,
    },
  });

  await logActivity("CREATED", "StockFieldConfig", config.id, `Created custom field: ${config.fieldLabel}`);
  revalidatePath("/configure");
  return { success: true, config };
}

export async function updateFieldConfig(id: string, data: unknown) {
  await requirePermission(PERMISSIONS.STOCK_CONFIG_FIELDS);

  const parsed = fieldConfigSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Check for duplicate name (excluding current)
  const existing = await prisma.stockEntryFieldConfig.findFirst({
    where: { fieldName: parsed.data.fieldName, id: { not: id } },
  });
  if (existing) return { error: "A field with this name already exists" };

  const config = await prisma.stockEntryFieldConfig.update({
    where: { id },
    data: {
      ...parsed.data,
      options: parsed.data.options ?? undefined,
    },
  });

  await logActivity("UPDATED", "StockFieldConfig", config.id, `Updated custom field: ${config.fieldLabel}`);
  revalidatePath("/configure");
  return { success: true, config };
}

export async function toggleFieldConfig(id: string) {
  await requirePermission(PERMISSIONS.STOCK_CONFIG_FIELDS);

  const config = await prisma.stockEntryFieldConfig.findUnique({ where: { id } });
  if (!config) return { error: "Field config not found" };

  const updated = await prisma.stockEntryFieldConfig.update({
    where: { id },
    data: { isActive: !config.isActive },
  });

  await logActivity(
    updated.isActive ? "ACTIVATED" : "DEACTIVATED",
    "StockFieldConfig",
    id,
    `${updated.isActive ? "Activated" : "Deactivated"} custom field: ${updated.fieldLabel}`
  );
  revalidatePath("/configure");
  return { success: true };
}

export async function deleteFieldConfig(id: string) {
  await requirePermission(PERMISSIONS.STOCK_CONFIG_FIELDS);

  const config = await prisma.stockEntryFieldConfig.findUnique({ where: { id } });
  if (!config) return { error: "Field config not found" };

  await prisma.stockEntryFieldConfig.delete({ where: { id } });

  await logActivity("DELETED", "StockFieldConfig", id, `Deleted custom field: ${config.fieldLabel}`);
  revalidatePath("/configure");
  return { success: true };
}

// =====================
// Attachment Type Configs
// =====================

export async function getAttachmentTypeConfigs() {
  await requirePermission(PERMISSIONS.STOCK_CONFIG_ATTACHMENTS);
  return prisma.attachmentTypeConfig.findMany({
    orderBy: { name: "asc" },
  });
}

export async function createAttachmentTypeConfig(data: unknown) {
  await requirePermission(PERMISSIONS.STOCK_CONFIG_ATTACHMENTS);

  const parsed = attachmentTypeSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const existing = await prisma.attachmentTypeConfig.findUnique({
    where: { name: parsed.data.name },
  });
  if (existing) return { error: "An attachment type with this name already exists" };

  const config = await prisma.attachmentTypeConfig.create({
    data: {
      ...parsed.data,
      allowedMimeTypes: parsed.data.allowedMimeTypes ?? undefined,
    },
  });

  await logActivity("CREATED", "AttachmentTypeConfig", config.id, `Created attachment type: ${config.name}`);
  revalidatePath("/configure");
  return { success: true, config };
}

export async function updateAttachmentTypeConfig(id: string, data: unknown) {
  await requirePermission(PERMISSIONS.STOCK_CONFIG_ATTACHMENTS);

  const parsed = attachmentTypeSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const existing = await prisma.attachmentTypeConfig.findFirst({
    where: { name: parsed.data.name, id: { not: id } },
  });
  if (existing) return { error: "An attachment type with this name already exists" };

  const config = await prisma.attachmentTypeConfig.update({
    where: { id },
    data: {
      ...parsed.data,
      allowedMimeTypes: parsed.data.allowedMimeTypes ?? undefined,
    },
  });

  await logActivity("UPDATED", "AttachmentTypeConfig", config.id, `Updated attachment type: ${config.name}`);
  revalidatePath("/configure");
  return { success: true, config };
}

export async function toggleAttachmentTypeConfig(id: string) {
  await requirePermission(PERMISSIONS.STOCK_CONFIG_ATTACHMENTS);

  const config = await prisma.attachmentTypeConfig.findUnique({ where: { id } });
  if (!config) return { error: "Attachment type config not found" };

  const updated = await prisma.attachmentTypeConfig.update({
    where: { id },
    data: { isActive: !config.isActive },
  });

  await logActivity(
    updated.isActive ? "ACTIVATED" : "DEACTIVATED",
    "AttachmentTypeConfig",
    id,
    `${updated.isActive ? "Activated" : "Deactivated"} attachment type: ${updated.name}`
  );
  revalidatePath("/configure");
  return { success: true };
}

export async function deleteAttachmentTypeConfig(id: string) {
  await requirePermission(PERMISSIONS.STOCK_CONFIG_ATTACHMENTS);

  const config = await prisma.attachmentTypeConfig.findUnique({ where: { id } });
  if (!config) return { error: "Attachment type not found" };

  await prisma.attachmentTypeConfig.delete({ where: { id } });

  await logActivity("DELETED", "AttachmentTypeConfig", id, `Deleted attachment type: ${config.name}`);
  revalidatePath("/configure");
  return { success: true };
}

// =====================
// Approval Flow Configs
// =====================

export async function getApprovalFlows() {
  await requirePermission(PERMISSIONS.STOCK_CONFIG_FLOWS);
  return prisma.approvalFlowConfig.findMany({
    include: {
      department: { select: { id: true, name: true } },
      steps: {
        include: { approverRole: { select: { id: true, name: true } } },
        orderBy: { stepOrder: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function createApprovalFlow(data: unknown) {
  await requirePermission(PERMISSIONS.STOCK_CONFIG_FLOWS);

  const parsed = approvalFlowSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Check if department already has a flow
  if (parsed.data.departmentId) {
    const existing = await prisma.approvalFlowConfig.findUnique({
      where: { departmentId: parsed.data.departmentId },
    });
    if (existing) return { error: "This department already has an approval flow" };
  }

  const flow = await prisma.approvalFlowConfig.create({
    data: {
      name: parsed.data.name,
      departmentId: parsed.data.departmentId ?? null,
      isActive: parsed.data.isActive,
    },
  });

  await logActivity("CREATED", "ApprovalFlowConfig", flow.id, `Created approval flow: ${flow.name}`);
  revalidatePath("/configure");
  return { success: true, flow };
}

export async function updateApprovalFlow(id: string, data: unknown) {
  await requirePermission(PERMISSIONS.STOCK_CONFIG_FLOWS);

  const parsed = approvalFlowSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const flow = await prisma.approvalFlowConfig.update({
    where: { id },
    data: {
      name: parsed.data.name,
      isActive: parsed.data.isActive,
    },
  });

  await logActivity("UPDATED", "ApprovalFlowConfig", flow.id, `Updated approval flow: ${flow.name}`);
  revalidatePath("/configure");
  return { success: true, flow };
}

export async function addApprovalFlowStep(flowId: string, data: unknown) {
  await requirePermission(PERMISSIONS.STOCK_CONFIG_FLOWS);

  const parsed = approvalFlowStepSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Check for duplicate step order
  const existing = await prisma.approvalFlowStep.findUnique({
    where: { flowId_stepOrder: { flowId, stepOrder: parsed.data.stepOrder } },
  });
  if (existing) return { error: "A step with this order already exists in this flow" };

  const step = await prisma.approvalFlowStep.create({
    data: {
      flowId,
      ...parsed.data,
    },
  });

  await logActivity("CREATED", "ApprovalFlowStep", step.id, `Added step "${step.stepLabel}" to flow`);
  revalidatePath("/configure");
  return { success: true, step };
}

export async function removeApprovalFlowStep(stepId: string) {
  await requirePermission(PERMISSIONS.STOCK_CONFIG_FLOWS);

  const step = await prisma.approvalFlowStep.findUnique({ where: { id: stepId } });
  if (!step) return { error: "Step not found" };

  await prisma.approvalFlowStep.delete({ where: { id: stepId } });

  await logActivity("DELETED", "ApprovalFlowStep", stepId, `Removed step "${step.stepLabel}" from flow`);
  revalidatePath("/configure");
  return { success: true };
}

