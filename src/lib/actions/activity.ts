"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser, requireAuth } from "@/lib/rbac/check";
import { resolveActivityScope } from "@/lib/rbac/permissions";
import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_CATEGORY_KEYS,
  SECURITY_ACTIONS,
  readableCategories,
  type ActivityCategory,
} from "@/lib/activity-categories";
import type { Prisma } from "@prisma/client";

/**
 * The activity log: writing to it, and reading it back.
 *
 * Called by: every other action calls `logActivity` after it changes something,
 * and the Activity page calls `getActivityLogs`.
 *
 * Owns two rules that are deliberately separate. WHAT you may read is decided
 * by the six `activity.view.*` category keys; WHOSE actions you may read is
 * decided by `activity.scope.*`. Someone can be trusted with the whole
 * company's catalog history and none of its passwords, or with their own
 * department's everything.
 */

export async function logActivity(
  action: string,
  entity: string,
  entityId?: string,
  details?: string
) {
  const user = await getCurrentUser();
  if (!user) return;

  await prisma.activityLog.create({
    data: {
      action,
      entity,
      entityId: entityId ?? undefined,
      details: details ?? undefined,
      userId: user.id,
      // Snapshotted so that deleting a person leaves their history searchable
      // by name rather than erasing what they did
      actorName: user.name,
    },
  });
}

/**
 * A `where` matching exactly the categories given.
 *
 * Security is not purely a matter of which entity was touched — a password
 * reveal is recorded against a User but belongs to Security, so the actions
 * move between buckets rather than the entities alone deciding.
 */
function buildCategoryWhere(categories: ActivityCategory[]): Prisma.ActivityLogWhereInput {
  const includesSecurity = categories.includes("security");

  const entities = categories.flatMap(
    (c) => ACTIVITY_CATEGORIES[c].entities as readonly string[]
  );

  // Entities that belong to a category this person cannot read
  const forbiddenEntities = ACTIVITY_CATEGORY_KEYS.filter(
    (c) => !categories.includes(c)
  ).flatMap((c) => ACTIVITY_CATEGORIES[c].entities as readonly string[]);

  const or: Prisma.ActivityLogWhereInput[] = [
    // Anything in a readable category, unless the action itself is a security
    // event that has been lifted out of it
    {
      entity: { in: [...new Set(entities)] },
      ...(includesSecurity ? {} : { action: { notIn: SECURITY_ACTIONS } }),
    },
  ];

  if (includesSecurity) {
    // Security also sweeps up the actions and anything with no home yet
    or.push({ action: { in: SECURITY_ACTIONS } });
    or.push({ entity: { notIn: [...new Set([...entities, ...forbiddenEntities])] } });
  }

  return { OR: or };
}

export async function getActivityLogs(options?: {
  page?: number;
  limit?: number;
  entity?: string;
  userId?: string;
  /** Named category filter — see ACTIVITY_CATEGORIES */
  category?: ActivityCategory;
  /** Show only actions performed by members of this department */
  departmentId?: string;
  /** Free text across the action, entity, details and who did it */
  search?: string;
}) {
  const currentUser = await requireAuth();
  const page = options?.page ?? 1;
  const limit = options?.limit ?? 20;
  const skip = (page - 1) * limit;

  const clauses: Record<string, unknown>[] = [];
  if (options?.entity) clauses.push({ entity: options.entity });
  if (options?.userId) clauses.push({ userId: options.userId });

  const search = options?.search?.trim();
  if (search) {
    clauses.push({
      OR: [
        { action: { contains: search, mode: "insensitive" } },
        { entity: { contains: search, mode: "insensitive" } },
        { details: { contains: search, mode: "insensitive" } },
        // actorName is the snapshot, so a deleted person is still findable
        { actorName: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  // What this person is allowed to read at all. The page gate (activity.view)
  // opens the door; these decide what is behind it.
  const allowed = readableCategories(currentUser.permissions);
  if (allowed.length === 0) {
    return { logs: [], total: 0, pages: 0, allowedCategories: [] as ActivityCategory[] };
  }

  // Narrowing to one category is only honoured if it is one they may read
  const wanted =
    options?.category && allowed.includes(options.category) ? [options.category] : allowed;

  clauses.push(buildCategoryWhere(wanted));

  if (options?.departmentId) {
    clauses.push({ user: { departmentId: options.departmentId } });
  }

  // How far this person's view reaches — a permission, not a job title. See
  // resolveActivityScope for what each tier means.
  const scope = resolveActivityScope(currentUser);

  if (scope === "department" && currentUser.departmentId) {
    // Their department: actions by its members (including themselves), and
    // actions done TO its members — "someone changed Deepa's role" is their
    // business even though an admin performed it.
    const departmentUserIds = (
      await prisma.user.findMany({
        where: { departmentId: currentUser.departmentId },
        select: { id: true },
      })
    ).map((u) => u.id);

    clauses.push({
      OR: [
        { userId: { in: [...departmentUserIds, currentUser.id] } },
        { entity: "User", entityId: { in: departmentUserIds } },
      ],
    });
  } else if (scope !== "all") {
    // `own`, and `department` for someone with no department to scope to
    clauses.push({ userId: currentUser.id });
  }

  const where: Record<string, unknown> = clauses.length > 0 ? { AND: clauses } : {};

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.activityLog.count({ where }),
  ]);

  // The UI only offers the filters this person may actually use
  return { logs, total, pages: Math.ceil(total / limit), allowedCategories: allowed };
}
