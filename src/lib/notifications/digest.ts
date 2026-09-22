import { prisma } from "@/lib/prisma";
import { sendMail } from "./mail";

/**
 * The morning summary: one mail per person who asked for it, listing their
 * notifications from the last day that have not been in a summary yet —
 * mailed individually or not, so the summary is complete on its own. Sent by
 * the daily job (src/app/api/cron/daily/route.ts).
 */
export async function sendDigests(): Promise<{ sent: number }> {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const people = await prisma.user.findMany({
    where: { isActive: true, mailDigest: true },
    select: { id: true, email: true, name: true },
  });

  let sent = 0;
  for (const person of people) {
    const items = await prisma.notification.findMany({
      where: { userId: person.id, digestedAt: null, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    if (items.length === 0) continue;
    const ok = await sendMail({
      to: person.email,
      subject: `SD-SIM: ${items.length} update${items.length === 1 ? "" : "s"} from the last day`,
      heading: `Good morning, ${person.name.split(" ")[0]} — here is what happened`,
      lines: items.map((n) => ({ text: n.body ? `${n.title} — ${n.body}` : n.title, href: n.href ?? undefined })),
    });
    if (ok) {
      sent++;
      await prisma.notification.updateMany({ where: { id: { in: items.map((n) => n.id) } }, data: { digestedAt: new Date() } });
    }
  }
  return { sent };
}
