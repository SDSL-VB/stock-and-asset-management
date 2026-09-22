import { after } from "next/server";
import type { NotificationKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { holdersOf } from "./recipients";
import { sendMail } from "./mail";

/**
 * Telling people things. Every notification lands in the recipient's bell;
 * whoever chose that kind for mail (My Profile → Notifications) also gets it
 * by mail straight away, and whoever chose the morning summary gets it there
 * (src/lib/notifications/digest.ts).
 *
 *   ACTION      something waits for you to approve, verify or answer
 *   DECIDED     something you raised was approved, sent back, ordered…
 *   LOW_STOCK   a watched product needs ordering
 *   ORDER_LATE  an order line is past its due date
 *
 * Never lets a failure reach the caller: an approval must not fail because a
 * mail server is down. Mail goes out after the response is sent, so the person
 * pressing the button does not wait for it.
 *
 * `dedupeKey` makes a notification once-only per person — the low-stock and
 * late-order checks run repeatedly and must not repeat themselves.
 */
type Message = {
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  dedupeKey?: string;
};

export async function notify(userIds: string[], message: Message): Promise<void> {
  const recipients = [...new Set(userIds)];
  if (recipients.length === 0) return;
  try {
    await prisma.notification.createMany({
      data: recipients.map((userId) => ({ userId, ...message })),
      skipDuplicates: true,
    });
    after(() => mailInstant(recipients, message).catch((e) => console.error("Notification mail failed:", e)));
  } catch (e) {
    console.error("Notification failed:", e);
  }
}

/** Notify everyone holding a permission, at the place it concerns. */
export async function notifyHolders(
  permission: string,
  where: Parameters<typeof holdersOf>[1],
  message: Message
): Promise<void> {
  try {
    await notify(await holdersOf(permission, where), message);
  } catch (e) {
    console.error("Notification failed:", e);
  }
}

/** Mail the ones just created, to the people who want this kind by mail. */
async function mailInstant(userIds: string[], message: Message) {
  const wanting = await prisma.user.findMany({
    where: { id: { in: userIds }, isActive: true, mailInstantKinds: { has: message.kind } },
    select: { id: true, email: true },
  });
  for (const user of wanting) {
    // Only rows not mailed yet — a deduplicated repeat was never created
    const rows = await prisma.notification.findMany({
      where: { userId: user.id, emailedAt: null, title: message.title, dedupeKey: message.dedupeKey ?? null },
      select: { id: true },
    });
    if (rows.length === 0) continue;
    const sent = await sendMail({
      to: user.email,
      subject: message.title,
      heading: message.title,
      lines: [{ text: message.body ?? "Open it in SD-SIM", href: message.href }],
    });
    if (sent) {
      await prisma.notification.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { emailedAt: new Date() } });
    }
  }
}
