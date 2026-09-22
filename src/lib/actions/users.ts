"use server";

import { prisma } from "@/lib/prisma";
import {
  requirePermission,
  requireAnyPermission,
  requireAuth,
  holdsRole,
} from "@/lib/rbac/check";
import { refusalOver, refusalToAssign } from "@/lib/rbac/authority";
import { PERMISSIONS, ROLES } from "@/lib/rbac/permissions";
import {
  createUserSchema,
  updateUserSchema,
  changePasswordSchema,
} from "@/lib/validations/user";
import { ensureDeletedUser } from "@/lib/deleted-user";
import { archive, type Relink } from "@/lib/recycle-bin";
import { logActivity } from "@/lib/activity-log";
import bcrypt from "bcryptjs";
import {
  encryptPassword,
  decryptPassword,
  isPasswordVaultEnabled,
} from "@/lib/crypto";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";

/**
 * Team members: their details, their credentials, and the roles they hold.
 *
 * Called by: the Team Members pages and every "who?" picker.
 *
 * Three rules worth knowing. Reads select explicit fields so the password
 * columns never reach the browser. Rank decides who can see and edit whom — you
 * see people at your own level or below. And deleting someone re-points their
 * records at a hidden system account rather than destroying them, so searching
 * a departed colleague's name still finds what they did.
 */

// Fields safe to hand to client components — never the password columns
const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  avatar: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, name: true } },
  // Roles held on top of the primary one. A person is the sum of all of them.
  additionalRoles: {
    select: {
      roleId: true,
      reason: true,
      createdAt: true,
      role: { select: { id: true, name: true } },
      grantedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  },
  department: {
    select: {
      id: true,
      name: true,
      // A person's site comes from their department, so the directory can group by it
      location: { select: { id: true, name: true } },
    },
  },
} as const;

export async function getUsers() {
  const currentUser = await requirePermission(PERMISSIONS.USERS_VIEW);

  // You see people at your own rank or below. Super Admin (0) and Admin (1)
  // see everyone. The session carries the strongest rank held, so a second role
  // can widen this but never narrow it.
  // The placeholder that owns deleted people's records is never a team member.
  const currentLevel = currentUser.hierarchyLevel;
  const where: Record<string, unknown> = { isSystem: false };
  if (currentLevel >= 2) {
    where.role = {
      hierarchyLevel: { gte: currentLevel },
    };
    // Department Managers also only see their own department
    if (holdsRole(currentUser, ROLES.DEPARTMENT_MANAGER) && currentUser.departmentId) {
      where.departmentId = currentUser.departmentId;
    }
  }

  return prisma.user.findMany({
    where,
    select: USER_SELECT,
    orderBy: { createdAt: "desc" },
  });
}

export async function getUserById(id: string) {
  await requirePermission(PERMISSIONS.USERS_VIEW);

  return prisma.user.findUnique({
    where: { id },
    select: USER_SELECT,
  });
}

export async function createUser(data: unknown) {
  const currentUser = await requirePermission(PERMISSIONS.USERS_CREATE);

  const parsed = createUserSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { password, departmentId, ...rest } = parsed.data;

  const roleRefusal = await refusalToAssign(currentUser, rest.roleId);
  if (roleRefusal) return { error: roleRefusal };
  if (departmentId && !(await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true } }))) {
    return { error: "That department no longer exists" };
  }

  // Check for duplicate email
  const existing = await prisma.user.findUnique({
    where: { email: rest.email },
  });
  if (existing) {
    return { error: "A user with this email already exists" };
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      ...rest,
      password: hashedPassword,
      // Recoverable copy so admins with users.password.view can read it back
      passwordEnc: encryptPassword(password),
      passwordSetAt: new Date(),
      passwordSetBy: currentUser.name,
      // Somebody else picked this password, so it is a temporary one until the
      // new person replaces it — see middleware.ts.
      mustChangePassword: true,
      departmentId: departmentId || undefined,
    },
    include: { role: { select: { name: true } } },
  });

  await logActivity(
    "CREATED",
    "User",
    user.id,
    `Added ${user.name} as ${user.role.name}`
  );

  revalidatePath("/users");
  return { success: true, user };
}

export async function updateUser(id: string, data: unknown) {
  const currentUser = await requirePermission(PERMISSIONS.USERS_EDIT);

  const refusal = await refusalOver(currentUser, id);
  if (refusal) return { error: refusal };

  const parsed = updateUserSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { departmentId, ...rest } = parsed.data;

  const roleRefusal = await refusalToAssign(currentUser, rest.roleId);
  if (roleRefusal) return { error: roleRefusal };

  // Check for duplicate email (excluding current user)
  const existing = await prisma.user.findFirst({
    where: { email: rest.email, id: { not: id } },
  });
  if (existing) {
    return { error: "A user with this email already exists" };
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...rest,
      departmentId: departmentId || null,
    },
    include: { role: { select: { name: true } } },
  });

  await logActivity("UPDATED", "User", user.id, `Updated ${user.name}`);

  revalidatePath("/users");
  revalidatePath(`/users/${id}`);
  return { success: true, user };
}

export async function toggleUserStatus(id: string) {
  const currentUser = await requirePermission(PERMISSIONS.USERS_DELETE);

  const user = await prisma.user.findUnique({
    where: { id },
    include: { role: { select: { name: true } } },
  });
  if (!user) return { error: "User not found" };

  const refusal = await refusalOver(currentUser, id);
  if (refusal) return { error: refusal };

  const updated = await prisma.user.update({
    where: { id },
    data: { isActive: !user.isActive },
  });

  await logActivity(
    updated.isActive ? "ACTIVATED" : "DEACTIVATED",
    "User",
    id,
    `${updated.isActive ? "Activated" : "Deactivated"} ${updated.name}`
  );

  revalidatePath("/users");
  revalidatePath(`/users/${id}`);
  return { success: true };
}

/**
 * Permanently deletes an account.
 *
 * Anyone with linked records gets a confirmation step first, recommending
 * deactivation — but if the caller insists with { force: true }, the deletion
 * goes ahead and their records are re-pointed at a placeholder account rather
 * than destroyed. Activity logs keep the person's name as a snapshot, so
 * searching for them still finds what they did.
 */
/**
 * Every column, in every table, that points at a person.
 *
 * Deleting someone re-points each of these at the hidden system account rather
 * than deleting the records, so the history stays and nothing is orphaned (see
 * src/lib/deleted-user.ts). This one list is read three times by deleteUser —
 * to COUNT what the person is linked to, to RECORD it for undo, and to RE-POINT
 * it — so the three can never disagree.
 *
 * They used to be three hand-written lists, and they drifted: tables added
 * later (write-offs, purchase needs and orders, site requests, need requests, the
 * recycle bin itself) were in none of them. Deleting anybody who had ever raised
 * a need or used a Delete button then failed with a raw foreign-key error.
 *
 * When a new table gains a column pointing at a user, add it here. The two
 * links that cascade away with the account instead — the roles a person held
 * and the grants given TO them — are deliberately absent.
 *
 * Names are Prisma model names; restoring from the recycle bin reads them back.
 */
const PERSON_LINKS = [
  ["ActivityLog", "userId"],
  ["StockEntry", "createdById"],
  ["StockEntry", "approvedById"],
  ["StockEntryAttachment", "uploadedById"],
  ["StockApproval", "approverUserId"],
  ["StockIssue", "issuedById"],
  ["StockWriteOff", "raisedById"],
  ["StockWriteOff", "reviewedById"],
  ["StockWriteOff", "reversedById"],
  ["ProductRequest", "requestedById"],
  ["ProductRequest", "reviewedById"],
  ["StockTransferRequest", "requestedById"],
  ["StockTransferRequest", "reviewedById"],
  ["BillOfMaterials", "createdById"],
  ["BillOfMaterials", "approvedById"],
  ["Build", "builtById"],
  ["Dispatch", "createdById"],
  ["Dispatch", "acceptedById"],
  ["Dispatch", "receivedById"],
  ["SiteRequest", "requestedById"],
  ["SiteRequest", "reviewedById"],
  ["PurchaseIntent", "requestedById"],
  ["PurchaseIntent", "reviewedById"],
  ["PurchaseOrder", "createdById"],
  ["PurchaseOrder", "closedById"],
  ["NeedList", "createdById"],
  ["DeletedRecord", "deletedById"],
  ["UserPermission", "grantedById"],
  ["UserRole", "grantedById"],
] as const;

type LinkDelegate = {
  count(args: { where: Record<string, string> }): Promise<number>;
  findMany(args: { where: Record<string, string>; select: { id: true } }): Promise<{ id: string }[]>;
  updateMany(args: { where: Record<string, string>; data: Record<string, string> }): Promise<unknown>;
};

/** The Prisma delegate for a model name, e.g. "StockEntry" → client.stockEntry. */
function delegateFor(client: Prisma.TransactionClient, table: string): LinkDelegate {
  const key = table.charAt(0).toLowerCase() + table.slice(1);
  return (client as unknown as Record<string, LinkDelegate>)[key];
}

export async function deleteUser(id: string, options: { force?: boolean } = {}) {
  const currentUser = await requirePermission(PERMISSIONS.USERS_DELETE);

  const user = await prisma.user.findUnique({
    where: { id },
    include: { role: { select: { name: true } } },
  });
  if (!user) return { error: "User not found" };

  const refusal = await refusalOver(currentUser, id);
  if (refusal) return { error: refusal };

  if (user.isSystem) {
    return { error: "That is a system account and cannot be deleted" };
  }

  // Everything that points at this person, counted from the same list that the
  // re-pointing below walks — so the nudge can never under-count them again.
  const linkCounts = await Promise.all(
    PERSON_LINKS.map(([table, field]) => delegateFor(prisma, table).count({ where: { [field]: id } }))
  );
  const references = linkCounts.reduce((sum, n) => sum + n, 0);

  // The nudge. Deleting used to be blocked outright here, which — because
  // activity logs count — meant nobody could ever be deleted, and a hard block
  // reads as a bug rather than a safety feature. Now it explains the cost,
  // recommends deactivating, and lets the caller insist.
  if (references > 0 && !options.force) {
    return {
      needsConfirmation: true,
      references,
      message: `"${user.name}" has ${references} linked record${references === 1 ? "" : "s"} — stock entries, approvals, requests and activity history.`,
      recommendation:
        "Deactivating removes them from every list and stops them signing in, while their history stays attached to their name.",
    };
  }

  await prisma.$transaction(async (tx) => {
    // Everything that will be re-pointed, captured *before* it moves — so
    // restoring puts exactly these rows back rather than guessing which ones
    // used to belong to this person.
    const relinks: Relink[] = [];
    if (references > 0) {
      for (const [table, field] of PERSON_LINKS) {
        const rows = await delegateFor(tx, table).findMany({ where: { [field]: id }, select: { id: true } });
        if (rows.length) relinks.push({ table, field, ids: rows.map((r) => r.id) });
      }
    }

    // The reversible password copy is not kept in the bin: a restored account
    // keeps its login (the one-way hash) but its password cannot be revealed.
    const { role: _role, passwordEnc: _readable, ...snapshot } = user;
    await archive(tx, {
      entity: "User",
      entityId: id,
      label: `${user.name} (${user.email})`,
      snapshot,
      relinks,
      deletedById: currentUser.id,
    });

    if (references > 0) {
      // Their work is re-pointed at a placeholder account rather than deleted,
      // so no record is orphaned. Activity logs already carry the actor's name
      // as a snapshot, which is what keeps a deleted person searchable.
      const tombstoneId = await ensureDeletedUser(tx);

      await Promise.all(
        PERSON_LINKS.map(([table, field]) =>
          delegateFor(tx, table).updateMany({ where: { [field]: id }, data: { [field]: tombstoneId } })
        )
      );
    }

    await tx.user.delete({ where: { id } });
  });

  await logActivity(
    "DELETED",
    "User",
    id,
    `Deleted account "${user.name}" (${user.email})${references > 0 ? `; ${references} linked record${references === 1 ? "" : "s"} kept and reassigned to the placeholder account` : ""}`
  );

  revalidatePath("/users");
  revalidatePath("/activity");
  return { success: true };
}

/**
 * Password metadata for the profile page — when it was last set, by whom, and
 * whether a recoverable copy exists. Never returns the password itself; the
 * plaintext only ever leaves the server through revealUserPassword().
 */
export async function getUserPasswordMeta(id: string) {
  await requireAnyPermission([
    PERMISSIONS.USERS_PASSWORD_VIEW,
    PERMISSIONS.USERS_PASSWORD_EDIT,
  ]);

  const user = await prisma.user.findUnique({
    where: { id },
    select: { passwordEnc: true, passwordSetAt: true, passwordSetBy: true },
  });
  if (!user) return null;

  return {
    canReveal: Boolean(user.passwordEnc) && isPasswordVaultEnabled(),
    setAt: user.passwordSetAt,
    setBy: user.passwordSetBy,
  };
}

/**
 * Decrypts and returns a user's password. Every successful reveal is written to
 * the activity log so there is an audit trail of who read whose credentials.
 */
export async function revealUserPassword(id: string) {
  const currentUser = await requirePermission(PERMISSIONS.USERS_PASSWORD_VIEW);

  const targetUser = await prisma.user.findUnique({
    where: { id },
    select: {
      name: true,
      passwordEnc: true,
      role: { select: { name: true } },
    },
  });
  if (!targetUser) return { error: "User not found" };

  const refusal = await refusalOver(currentUser, id);
  if (refusal) return { error: refusal };

  const password = decryptPassword(targetUser.passwordEnc);
  if (!password) {
    return {
      error:
        "This password cannot be shown — it was set before password visibility was enabled. Set a new password to make it viewable.",
    };
  }

  await logActivity(
    "PASSWORD_VIEWED",
    "User",
    id,
    `Viewed the password for ${targetUser.name}`
  );

  return { success: true, password };
}

/**
 * Sets a new password for a user. Stores the bcrypt hash used for login plus an
 * encrypted copy that users.password.view can read back.
 */
export async function setUserPassword(id: string, data: unknown) {
  const currentUser = await requirePermission(PERMISSIONS.USERS_PASSWORD_EDIT);

  const parsed = changePasswordSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Prevent resetting the Super Admin password unless you are Super Admin
  const targetUser = await prisma.user.findUnique({
    where: { id },
    include: { role: { select: { name: true } } },
  });
  if (!targetUser) return { error: "User not found" };
  const refusal = await refusalOver(currentUser, id);
  if (refusal) return { error: refusal };

  const hashedPassword = await bcrypt.hash(parsed.data.password, 12);
  const user = await prisma.user.update({
    where: { id },
    data: {
      password: hashedPassword,
      passwordEnc: encryptPassword(parsed.data.password),
      passwordSetAt: new Date(),
      passwordSetBy: currentUser.name,
      // Resetting somebody else's account leaves them with a password you know,
      // so they are made to replace it. Changing your own from this card is not
      // that, so it does not set the flag on yourself.
      mustChangePassword: currentUser.id !== id,
    },
  });

  await logActivity("PASSWORD_RESET", "User", id, `Changed the password for ${user.name}`);

  revalidatePath(`/users/${id}`);
  return { success: true };
}

export async function getRolesForSelect() {
  const currentUser = await requireAuth();

  const roles = await prisma.role.findMany({
    select: { id: true, name: true, hierarchyLevel: true },
    orderBy: { hierarchyLevel: "asc" },
  });

  // You can only hand out a role at or below your own rank, so nobody can
  // promote someone past themselves. The session already carries the strongest
  // rank held, which is what makes this work with more than one role.
  if (holdsRole(currentUser, ROLES.SUPER_ADMIN)) return roles;
  return roles.filter((r) => r.hierarchyLevel >= currentUser.hierarchyLevel);
}

/* ------------------------------------------------------------------------- */
/* Additional roles                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Give someone a role on top of their primary one.
 *
 * Gated on users.edit. The same two safety rules as an individual grant apply:
 * never a role outranking your own, and never to yourself — a person handing
 * themselves a second role is the one case the audit trail cannot explain.
 */
export async function addUserRole(userId: string, roleId: string, reason: string) {
  const currentUser = await requirePermission(PERMISSIONS.USERS_EDIT);
  const over = await refusalOver(currentUser, userId);
  if (over) return { error: over };

  const note = reason.trim();
  if (note.length < 3) return { error: "Say why this person needs the extra role" };
  if (userId === currentUser.id) {
    return { error: "You cannot give yourself an extra role" };
  }

  const [user, role] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, roleId: true } }),
    prisma.role.findUnique({ where: { id: roleId }, select: { name: true, hierarchyLevel: true } }),
  ]);
  if (!user) return { error: "That person no longer exists" };
  if (!role) return { error: "That role no longer exists" };

  if (
    !holdsRole(currentUser, ROLES.SUPER_ADMIN) &&
    role.hierarchyLevel < currentUser.hierarchyLevel
  ) {
    return { error: `${role.name} outranks you, so you cannot hand it out` };
  }
  if (user.roleId === roleId) {
    return { error: `That is already their main role` };
  }

  const existing = await prisma.userRole.findUnique({
    where: { userId_roleId: { userId, roleId } },
  });
  if (existing) return { error: `They already hold ${role.name}` };

  await prisma.userRole.create({
    data: { userId, roleId, reason: note, grantedById: currentUser.id },
  });

  await logActivity(
    "UPDATED",
    "User",
    userId,
    `Gave ${user.name} the ${role.name} role in addition to their own — ${note}`
  );

  revalidatePath(`/users/${userId}`);
  revalidatePath("/users");
  return { success: true };
}

/** Take an additional role away. The primary role is changed by editing it. */
export async function removeUserRole(userId: string, roleId: string) {
  const currentUser = await requirePermission(PERMISSIONS.USERS_EDIT);
  const over = await refusalOver(currentUser, userId);
  if (over) return { error: over };

  const held = await prisma.userRole.findUnique({
    where: { userId_roleId: { userId, roleId } },
    include: {
      user: { select: { name: true } },
      role: { select: { name: true, hierarchyLevel: true } },
    },
  });
  if (!held) return { error: "They do not hold that role" };

  if (
    !holdsRole(currentUser, ROLES.SUPER_ADMIN) &&
    held.role.hierarchyLevel < currentUser.hierarchyLevel
  ) {
    return { error: `${held.role.name} outranks you, so you cannot take it away` };
  }

  await prisma.userRole.delete({ where: { id: held.id } });

  await logActivity(
    "UPDATED",
    "User",
    userId,
    `Removed the ${held.role.name} role from ${held.user.name}`
  );

  revalidatePath(`/users/${userId}`);
  revalidatePath("/users");
  return { success: true };
}

export async function getDepartmentsForSelect() {
  await requireAuth();
  return prisma.department.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
