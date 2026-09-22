import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/rbac/check";

/**
 * Writing to the activity log. Every action that changes something calls this
 * afterwards; reading the log back is src/lib/actions/activity.ts.
 *
 * Deliberately NOT in a "use server" file. Everything exported from one of
 * those is an endpoint a browser can call with any arguments, and a log anyone
 * can write to — "Viewed the password for…", made up — is worth nothing.
 */
export async function logActivity(action: string, entity: string, entityId?: string, details?: string) {
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
