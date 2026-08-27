"use server";

import { prisma } from "@/lib/prisma";
import {
  requirePermission,
  requireAnyPermission,
  requireAuth,
  holdsRole,
} from "@/lib/rbac/check";
import { PERMISSIONS, ROLES } from "@/lib/rbac/permissions";
import {
  createUserSchema,
  updateUserSchema,
  changePasswordSchema,
} from "@/lib/validations/user";
import { ensureDeletedUser } from "@/lib/deleted-user";
import { archive, type Relink } from "@/lib/recycle-bin";
import { logActivity } from "./activity";
import bcrypt from "bcryptjs";
import {
  encryptPassword,
  decryptPassword,
  isPasswordVaultEnabled,
} from "@/lib/crypto";
import { revalidatePath } from "next/cache";

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

  // Prevent editing Super Admin unless you are Super Admin
  const targetUser = await prisma.user.findUnique({
    where: { id },
    include: { role: { select: { name: true } } },
  });
  if (!targetUser) return { error: "User not found" };

  if (targetUser.role.name === ROLES.SUPER_ADMIN && !holdsRole(currentUser, ROLES.SUPER_ADMIN)) {
    return { error: "Only the Super Admin can modify the Super Admin account" };
  }

  const parsed = updateUserSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const { departmentId, ...rest } = parsed.data;

  // Prevent assigning Super Admin role unless you are Super Admin
  if (rest.roleId) {
    const targetRole = await prisma.role.findUnique({ where: { id: rest.roleId } });
    if (targetRole?.name === ROLES.SUPER_ADMIN && !holdsRole(currentUser, ROLES.SUPER_ADMIN)) {
      return { error: "Only the Super Admin can assign the Super Admin role" };
    }
  }

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

  // Prevent disabling your own account
  if (user.id === currentUser.id) {
    return { error: "You cannot disable your own account" };
  }

  // Prevent disabling Super Admin
  if (user.role.name === ROLES.SUPER_ADMIN && !holdsRole(currentUser, ROLES.SUPER_ADMIN)) {
    return { error: "The Super Admin account cannot be disabled" };
  }

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
export async function deleteUser(id: string, options: { force?: boolean } = {}) {
  const currentUser = await requirePermission(PERMISSIONS.USERS_DELETE);

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      role: { select: { name: true } },
      _count: {
        select: {
          activityLogs: true,
          stockEntriesCreated: true,
          stockEntriesApproved: true,
          attachmentsUploaded: true,
          approvalsGiven: true,
          stockIssuesCreated: true,
          productRequestsMade: true,
          productRequestsReviewed: true,
          transferRequestsMade: true,
          transferRequestsReviewed: true,
        },
      },
    },
  });
  if (!user) return { error: "User not found" };

  if (user.id === currentUser.id) {
    return { error: "You cannot delete your own account" };
  }
  if (user.role.name === ROLES.SUPER_ADMIN && !holdsRole(currentUser, ROLES.SUPER_ADMIN)) {
    return { error: "Only the Super Admin can delete a Super Admin account" };
  }

  if (user.isSystem) {
    return { error: "That is a system account and cannot be deleted" };
  }

  const c = user._count;
  const references =
    c.activityLogs +
    c.stockEntriesCreated +
    c.stockEntriesApproved +
    c.attachmentsUploaded +
    c.approvalsGiven +
    c.stockIssuesCreated +
    c.productRequestsMade +
    c.productRequestsReviewed +
    c.transferRequestsMade +
    c.transferRequestsReviewed;

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
      const grab = async (
        table: string,
        field: string,
        rows: Promise<{ id: string }[]>
      ) => {
        const found = await rows;
        if (found.length) relinks.push({ table, field, ids: found.map((r) => r.id) });
      };

      await Promise.all([
        grab("ActivityLog", "userId", tx.activityLog.findMany({ where: { userId: id }, select: { id: true } })),
        grab("StockEntry", "createdById", tx.stockEntry.findMany({ where: { createdById: id }, select: { id: true } })),
        grab("StockEntry", "approvedById", tx.stockEntry.findMany({ where: { approvedById: id }, select: { id: true } })),
        grab("StockEntryAttachment", "uploadedById", tx.stockEntryAttachment.findMany({ where: { uploadedById: id }, select: { id: true } })),
        grab("StockApproval", "approverUserId", tx.stockApproval.findMany({ where: { approverUserId: id }, select: { id: true } })),
        grab("StockIssue", "issuedById", tx.stockIssue.findMany({ where: { issuedById: id }, select: { id: true } })),
        grab("ProductRequest", "requestedById", tx.productRequest.findMany({ where: { requestedById: id }, select: { id: true } })),
        grab("ProductRequest", "reviewedById", tx.productRequest.findMany({ where: { reviewedById: id }, select: { id: true } })),
        grab("StockTransferRequest", "requestedById", tx.stockTransferRequest.findMany({ where: { requestedById: id }, select: { id: true } })),
        grab("StockTransferRequest", "reviewedById", tx.stockTransferRequest.findMany({ where: { reviewedById: id }, select: { id: true } })),
        grab("BillOfMaterials", "createdById", tx.billOfMaterials.findMany({ where: { createdById: id }, select: { id: true } })),
        grab("BillOfMaterials", "approvedById", tx.billOfMaterials.findMany({ where: { approvedById: id }, select: { id: true } })),
        grab("Build", "builtById", tx.build.findMany({ where: { builtById: id }, select: { id: true } })),
        grab("Dispatch", "createdById", tx.dispatch.findMany({ where: { createdById: id }, select: { id: true } })),
        grab("Dispatch", "acceptedById", tx.dispatch.findMany({ where: { acceptedById: id }, select: { id: true } })),
        grab("Dispatch", "receivedById", tx.dispatch.findMany({ where: { receivedById: id }, select: { id: true } })),
        grab("UserPermission", "grantedById", tx.userPermission.findMany({ where: { grantedById: id }, select: { id: true } })),
      ]);
    }

    const { role: _role, _count: _counts, ...snapshot } = user;
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

      await Promise.all([
        tx.activityLog.updateMany({ where: { userId: id }, data: { userId: tombstoneId } }),
        tx.stockEntry.updateMany({ where: { createdById: id }, data: { createdById: tombstoneId } }),
        tx.stockEntry.updateMany({ where: { approvedById: id }, data: { approvedById: tombstoneId } }),
        tx.stockEntryAttachment.updateMany({
          where: { uploadedById: id },
          data: { uploadedById: tombstoneId },
        }),
        tx.stockApproval.updateMany({
          where: { approverUserId: id },
          data: { approverUserId: tombstoneId },
        }),
        tx.stockIssue.updateMany({ where: { issuedById: id }, data: { issuedById: tombstoneId } }),
        tx.productRequest.updateMany({
          where: { requestedById: id },
          data: { requestedById: tombstoneId },
        }),
        tx.productRequest.updateMany({
          where: { reviewedById: id },
          data: { reviewedById: tombstoneId },
        }),
        tx.stockTransferRequest.updateMany({
          where: { requestedById: id },
          data: { requestedById: tombstoneId },
        }),
        tx.stockTransferRequest.updateMany({
          where: { reviewedById: id },
          data: { reviewedById: tombstoneId },
        }),
        tx.billOfMaterials.updateMany({
          where: { createdById: id },
          data: { createdById: tombstoneId },
        }),
        tx.billOfMaterials.updateMany({
          where: { approvedById: id },
          data: { approvedById: tombstoneId },
        }),
        tx.build.updateMany({ where: { builtById: id }, data: { builtById: tombstoneId } }),
        tx.dispatch.updateMany({ where: { createdById: id }, data: { createdById: tombstoneId } }),
        tx.dispatch.updateMany({ where: { acceptedById: id }, data: { acceptedById: tombstoneId } }),
        tx.dispatch.updateMany({ where: { receivedById: id }, data: { receivedById: tombstoneId } }),
        // Grants this person handed out stay readable; the grants they held go
        // with them, via the cascade on the account
        tx.userPermission.updateMany({
          where: { grantedById: id },
          data: { grantedById: tombstoneId },
        }),
      ]);
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

  // Only the Super Admin may read the Super Admin's password
  if (
    targetUser.role.name === ROLES.SUPER_ADMIN &&
    !holdsRole(currentUser, ROLES.SUPER_ADMIN)
  ) {
    return { error: "Only the Super Admin can view the Super Admin password" };
  }

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
  if (
    targetUser.role.name === ROLES.SUPER_ADMIN &&
    !holdsRole(currentUser, ROLES.SUPER_ADMIN)
  ) {
    return { error: "Only the Super Admin can change the Super Admin password" };
  }

  const hashedPassword = await bcrypt.hash(parsed.data.password, 12);
  const user = await prisma.user.update({
    where: { id },
    data: {
      password: hashedPassword,
      passwordEnc: encryptPassword(parsed.data.password),
      passwordSetAt: new Date(),
      passwordSetBy: currentUser.name,
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
  return prisma.department.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
