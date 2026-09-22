import { prisma } from "@/lib/prisma";

/**
 * Slowing down password guessing, counted in the database so it holds across
 * every server instance and survives restarts (an in-memory count on Vercel
 * resets whenever a new instance starts).
 *
 * Two counters, each over a 15-minute window from the first failure:
 *
 *   email + address   8 wrong tries on one account from one place
 *   address alone     30 wrong tries from one place, whatever the account
 *
 * Keyed by address as well as email so that someone who knows a colleague's
 * email cannot lock them out from elsewhere simply by guessing wrong on purpose.
 */
const WINDOW_MS = 15 * 60 * 1000;
const LIMITS = { account: 8, address: 30 };

const keysFor = (email: string, address: string) => ({
  account: `acct:${email.toLowerCase()}|${address}`,
  address: `addr:${address}`,
});

export async function isThrottled(email: string, address: string): Promise<boolean> {
  const keys = keysFor(email, address);
  const since = new Date(Date.now() - WINDOW_MS);
  const rows = await prisma.loginFailure.findMany({
    where: { key: { in: [keys.account, keys.address] }, firstAt: { gt: since } },
  });
  return rows.some((r) => r.count >= (r.key === keys.account ? LIMITS.account : LIMITS.address));
}

export async function recordFailure(email: string, address: string): Promise<void> {
  const since = new Date(Date.now() - WINDOW_MS);
  for (const key of Object.values(keysFor(email, address))) {
    const row = await prisma.loginFailure.findUnique({ where: { key } });
    await prisma.loginFailure.upsert({
      where: { key },
      // A window that has run out starts again rather than counting on
      update: row && row.firstAt > since ? { count: { increment: 1 } } : { count: 1, firstAt: new Date() },
      create: { key, count: 1, firstAt: new Date() },
    });
  }
}

export async function clearFailures(email: string, address: string): Promise<void> {
  await prisma.loginFailure.deleteMany({ where: { key: keysFor(email, address).account } });
}
