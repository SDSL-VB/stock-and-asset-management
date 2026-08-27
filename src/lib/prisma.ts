import { PrismaClient } from "@prisma/client";

/**
 * The database client, created once.
 *
 * Called by: every server action.
 *
 * It is cached on `globalThis` because the dev server reloads modules on every
 * change, and a fresh client each time would open connections until Postgres
 * refused any more.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
