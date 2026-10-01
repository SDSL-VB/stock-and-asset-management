import { PrismaClient } from "@prisma/client";
import { applyRolesAndPeople } from "./setup-roles-and-people";
import { ATTACHMENT_TYPES, DOCUMENT_MIME_TYPES } from "./lib/reference-data";

/**
 * Sets up a NEW, EMPTY production database: the permission catalog, every role,
 * the stock approval flow, the attachment types — and exactly two accounts,
 * Super Admin and Admin. Sites, departments and everyone else are added in the
 * app afterwards.
 *
 *   npx tsx prisma/fresh-start.ts        (after `prisma migrate deploy`)
 *
 * It refuses to run on a database that already has any account, so it can
 * never be pointed at live data by mistake. Unlike the seed it wipes nothing.
 *
 * Each account gets a random starting password, printed ONCE below and never
 * stored anywhere else; both must be changed at first sign-in.
 */
const ACCOUNTS = ["superadmin@straightdrivesport.com", "shravani@straightdrivesport.com"];

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.count();
  if (existing > 0) {
    throw new Error(`Refusing: this database already has ${existing} account(s). fresh-start is for an empty database only.`);
  }

  await applyRolesAndPeople(prisma, { onlyEmails: ACCOUNTS });

  await prisma.attachmentTypeConfig.createMany({
    data: ATTACHMENT_TYPES.map((type) => ({ ...type, isActive: true, allowedMimeTypes: DOCUMENT_MIME_TYPES })),
    skipDuplicates: true,
  });

  console.log("\nDone. Copy the two starting passwords above somewhere safe now — they are not shown again.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
