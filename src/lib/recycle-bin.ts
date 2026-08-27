import type { Prisma } from "@prisma/client";

/**
 * The recycle bin.
 *
 * Deleting stays real — the row genuinely leaves its table — but a full copy is
 * archived first so it can be put back. The alternative, flagging every row as
 * soft-deleted, would require roughly a hundred existing queries to start
 * excluding deleted rows, and a single missed filter silently resurfaces a
 * deleted product in a dropdown. This way no existing query changes at all.
 *
 * Two things get archived:
 *
 *   snapshot  the row itself, restored verbatim under its original id
 *   relinks   what was unlinked or re-pointed on the way out, so restoring
 *             puts those back instead of guessing
 */

/**
 * How long a deleted record stays recoverable. One number, one place — change
 * it here and the bin, the UI copy and the expiry all follow.
 */
export const RECYCLE_BIN_DAYS = 30;

export function recycleBinExpiry(from = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + RECYCLE_BIN_DAYS);
  return d;
}

/**
 * Rows that pointed at the deleted record and were changed on the way out.
 *
 * `table` is the Prisma model, `field` the column that was cleared or
 * re-pointed, and `ids` the exact rows affected — recorded rather than
 * re-derived, because by restore time the world may have moved on.
 */
export type Relink = {
  table: string;
  field: string;
  ids: string[];
  /** What the field was set to on delete; null means it was cleared */
  replacedWith?: string | null;
};

export type RecycleEntity =
  | "User"
  | "Product"
  | "ProductCategory"
  | "Vendor"
  | "Client"
  | "BillOfMaterials";

/** Plain-English names, so the bin never shows a Prisma model name. */
export const ENTITY_LABELS: Record<RecycleEntity, string> = {
  User: "Team member",
  Product: "Product",
  ProductCategory: "Category",
  Vendor: "Vendor",
  Client: "Client",
  BillOfMaterials: "Bill of materials",
};

/**
 * Archives a row before it is deleted. Call inside the same transaction as the
 * delete, so a failure leaves neither the bin entry nor the deletion behind.
 */
export async function archive(
  tx: Prisma.TransactionClient,
  input: {
    entity: RecycleEntity;
    entityId: string;
    label: string;
    snapshot: unknown;
    relinks?: Relink[];
    deletedById: string;
  }
): Promise<string> {
  const created = await tx.deletedRecord.create({
    select: { id: true },
    data: {
      entity: input.entity,
      entityId: input.entityId,
      label: input.label,
      snapshot: input.snapshot as Prisma.InputJsonValue,
      relinks: (input.relinks ?? []) as unknown as Prisma.InputJsonValue,
      deletedById: input.deletedById,
      expiresAt: recycleBinExpiry(),
    },
  });
  return created.id;
}

/**
 * Puts the relinked rows back.
 *
 * Rows that have since been deleted themselves are skipped rather than failing
 * the whole restore — the point is to recover as much as still exists.
 */
export async function applyRelinks(tx: Prisma.TransactionClient, relinks: Relink[], id: string) {
  for (const link of relinks) {
    if (link.ids.length === 0) continue;

    // The model name as Prisma exposes it on the client (camelCase)
    const delegate = (tx as unknown as Record<string, {
      updateMany: (args: unknown) => Promise<unknown>;
    }>)[lowerFirst(link.table)];
    if (!delegate) continue;

    await delegate.updateMany({
      where: { id: { in: link.ids } },
      data: { [link.field]: id },
    });
  }
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * A snapshot round-trips through JSON, so every Date comes back as an ISO
 * string and Prisma rejects it. Each restorer names its own date columns —
 * explicit rather than guessing from the shape of the value, because a
 * date-like string in a text column would otherwise be silently converted.
 */
export function reviveDates<T extends Record<string, unknown>>(
  row: T,
  dateFields: string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const field of dateFields) {
    const value = out[field];
    if (typeof value === "string") out[field] = new Date(value);
  }
  return out;
}

/** Columns every model in this codebase carries. */
export const COMMON_DATES = ["createdAt", "updatedAt"];
