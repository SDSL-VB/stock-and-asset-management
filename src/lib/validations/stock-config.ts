import { z } from "zod";

export const fieldConfigSchema = z.object({
  fieldName: z.string().min(1, "Field name is required").regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Field name must be alphanumeric with underscores"),
  fieldLabel: z.string().min(1, "Field label is required"),
  fieldType: z.enum(["TEXT", "NUMBER", "DATE", "SELECT", "TEXTAREA"]),
  isRequired: z.boolean().default(false),
  isActive: z.boolean().default(true),
  options: z.array(z.string()).optional(),
  displayOrder: z.coerce.number().int().min(0).default(0),
});

export const attachmentTypeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  isRequired: z.boolean().default(false),
  isActive: z.boolean().default(true),
  allowedMimeTypes: z.array(z.string()).optional(),
  maxSizeBytes: z.coerce.number().int().positive().default(5242880),
});

export const approvalFlowSchema = z.object({
  name: z.string().min(1, "Name is required"),
  departmentId: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
});

export const approvalFlowStepSchema = z.object({
  stepOrder: z.coerce.number().int().positive("Step order must be positive"),
  stepLabel: z.string().min(1, "Step label is required"),
  approverRoleId: z.string().min(1, "Approver role is required"),
});

