"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { NotificationKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/rbac/check";
import { mailConfigured } from "@/lib/notifications/mail";

/**
 * A person's own notifications and mail choices. Everything here acts only on
 * the signed-in person's rows — there is no way to read or change anyone
 * else's. Creating notifications is not an action at all: it happens inside
 * other actions, through src/lib/notifications/notify.ts.
 */

/** The bell: the latest 30, and how many are unread in all. */
export async function getMyNotifications() {
  const user = await requireAuth();
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        href: true,
        readAt: true,
        createdAt: true,
        // The bell shows a group as one line that opens — see the bell itself
        groupKey: true,
        groupLabel: true,
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return { items, unread };
}

/** Mark some (or, with no ids, all) of your own notifications read. */
export async function markNotificationsRead(ids?: string[]) {
  const user = await requireAuth();
  const parsed = z.array(z.string()).max(200).optional().safeParse(ids);
  if (!parsed.success) return { error: "Not a list of notifications" };
  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null, ...(parsed.data ? { id: { in: parsed.data } } : {}) },
    data: { readAt: new Date() },
  });
  return { success: true };
}

export async function getMyMailSettings() {
  const user = await requireAuth();
  const me = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { email: true, mailInstantKinds: true, mailDigest: true },
  });
  return { ...me, mailOn: mailConfigured() };
}

const mailSettingsSchema = z.object({
  instant: z.array(z.nativeEnum(NotificationKind)).max(4),
  digest: z.boolean(),
});

export async function saveMyMailSettings(data: unknown) {
  const user = await requireAuth();
  const parsed = mailSettingsSchema.safeParse(data);
  if (!parsed.success) return { error: "Those settings are not valid" };
  await prisma.user.update({
    where: { id: user.id },
    data: { mailInstantKinds: [...new Set(parsed.data.instant)], mailDigest: parsed.data.digest },
  });
  revalidatePath("/settings/profile");
  return { success: true };
}
