import type { Prisma } from "@prisma/client";

/**
 * When someone is deleted for real, their records have to go somewhere.
 *
 * Erasing the records would put holes in the audit trail — a stock entry with
 * no creator, an approval nobody gave. So a single system account inherits
 * them, and every activity log already carries the actor's name as a snapshot,
 * which means searching a deleted person's name still finds everything they
 * did. That is the whole point: the person is gone, the history is not.
 *
 * The account cannot sign in (`isSystem` is refused at authorize) and is hidden
 * from every list.
 */

export const DELETED_USER_EMAIL = "deleted-user@system.local";
export const DELETED_USER_NAME = "Deleted user";

/** Finds the tombstone account, creating it the first time it is needed. */
export async function ensureDeletedUser(tx: Prisma.TransactionClient): Promise<string> {
  const existing = await tx.user.findUnique({
    where: { email: DELETED_USER_EMAIL },
    select: { id: true },
  });
  if (existing) return existing.id;

  // It needs a role because the column is required; the lowest one will do,
  // since the account can never sign in and so never exercises a permission.
  const role =
    (await tx.role.findFirst({ orderBy: { hierarchyLevel: "desc" }, select: { id: true } })) ??
    null;
  if (!role) throw new Error("No roles exist, so the placeholder account cannot be created");

  const created = await tx.user.create({
    data: {
      name: DELETED_USER_NAME,
      email: DELETED_USER_EMAIL,
      // Not a usable hash — nothing will ever compare against it
      password: "!",
      isActive: false,
      isSystem: true,
      roleId: role.id,
    },
    select: { id: true },
  });
  return created.id;
}
