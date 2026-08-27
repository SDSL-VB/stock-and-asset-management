import { z } from "zod";

const stockEntryFields = {
  productId: z.string().min(1, "Please select a product from the catalog"),
  // Chosen from the vendor master; supplierName is snapshotted server-side
  vendorId: z.string().min(1, "Please select a vendor"),
  supplierName: z.string().optional(),
  quantity: z.number().int().positive("Quantity must be a positive number"),
  unitPrice: z.number().positive("Unit price must be a positive number"),
  invoiceNumber: z.string().optional(),
  // The site holding this stock. Even goods shipped straight from the vendor to
  // a client book in against a location before they leave as a dispatch.
  // Only required when the goods actually arrive at one of our sites. A
  // direct-to-client shipment never reaches a warehouse, so the server fills
  // this from the creator's own site instead of asking.
  locationId: z.string().optional(),
  /** The batch these goods belong to — a supplier lot, or a production run */
  batchNumber: z.string().trim().max(60, "Batch number is too long").optional(),
  /** Default nature when this stock later moves into a department */
  isAsset: z.boolean().optional(),
  /** Ships directly to a client without reaching our warehouse */
  isDirectToClient: z.boolean().optional(),
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  clientLocation: z.string().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  /**
   * The purchase order line these goods arrived against. Absent on a fresh
   * entry — plenty of stock arrives without an order behind it.
   */
  purchaseOrderLineId: z.string().optional(),
};

function requireClientOrLocation(
  data: { isDirectToClient?: boolean; clientId?: string; locationId?: string },
  ctx: z.RefinementCtx
) {
  // Exactly one of the two is asked for: a client for goods going straight out,
  // a location for goods arriving at a site.
  if (data.isDirectToClient) {
    if (!data.clientId?.trim()) {
      ctx.addIssue({ code: "custom", path: ["clientId"], message: "Please select a client" });
    }
    return;
  }
  if (!data.locationId?.trim()) {
    ctx.addIssue({ code: "custom", path: ["locationId"], message: "Please select a location" });
  }
}

export const createStockEntrySchema = z.object(stockEntryFields).superRefine(requireClientOrLocation);

export const updateStockEntrySchema = z.object(stockEntryFields).superRefine(requireClientOrLocation);

export const approveStockEntrySchema = z.object({
  comments: z.string().optional(),
});

export const rejectStockEntrySchema = z.object({
  reason: z.string().min(1, "Rejection reason is required"),
  comments: z.string().optional(),
});

// Warranty and registration, only validated when the box is ticked
export const warrantySchema = z.object({
  purchaseDate: z.string().min(1, "Date of purchase is required"),
  modelNumber: z.string().trim().min(1, "Model number is required"),
  serialNumber: z.string().trim().min(1, "Serial number is required"),
  modelName: z.string().trim().optional(),
  warrantyTill: z.string().min(1, "Warranty-till date is required"),
  notes: z.string().trim().optional(),
});

export const moveStockToDepartmentSchema = z.object({
  departmentId: z.string().min(1, "Please select a department"),
  quantity: z.number().int().positive("Quantity must be a positive number"),
  // Whether this lands in the department as an asset rather than stock
  isAsset: z.boolean().optional(),
  notes: z.string().optional(),
});

export type CreateStockEntryInput = z.infer<typeof createStockEntrySchema>;
