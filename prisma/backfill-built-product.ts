import { PrismaClient } from "@prisma/client";

/**
 * One-off repair: link built stock to the product it is.
 *
 * Until 28 Sep 2026 a build booked its finished goods in with no product
 * attached (src/lib/actions/builds.ts, createOutputEntry). The goods were
 * counted, valued and dispatchable, but anything that looks stock up BY product
 * — Find Stock, low stock, the site's shelf list — could not see them.
 *
 * The code is fixed for every build from now on. This fills in the ones already
 * made, taking the product from the build that produced each entry, so nothing
 * is guessed from a name or a code.
 *
 *   npx tsx --env-file=.env prisma/backfill-built-product.ts           dry run
 *   npx tsx --env-file=.env prisma/backfill-built-product.ts --apply   write
 *
 * A dry run changes nothing. Safe to run twice: an entry already linked is not
 * touched.
 */
const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgresql://unset").host;
  console.log(`Database: ${host}`);
  console.log(apply ? "Mode: APPLY" : "Mode: dry run (nothing will change)");

  const unlinked = await prisma.stockEntry.findMany({
    where: { source: "BUILT", productId: null, buildId: { not: null } },
    select: {
      id: true,
      entryNumber: true,
      itemCode: true,
      quantity: true,
      build: { select: { buildNumber: true, product: { select: { id: true, code: true, name: true } } } },
    },
    orderBy: { entryNumber: "asc" },
  });

  if (unlinked.length === 0) {
    console.log("\nNothing to repair — every built entry is linked to its product.");
    return;
  }

  console.log(`\n${unlinked.length} built entr${unlinked.length === 1 ? "y has" : "ies have"} no product:`);
  for (const e of unlinked) {
    const p = e.build?.product;
    console.log(`  ${e.entryNumber}  ×${e.quantity}  from ${e.build?.buildNumber ?? "?"}  →  ${p ? `${p.code} ${p.name}` : "NO PRODUCT ON THE BUILD — skipped"}`);
  }

  if (!apply) {
    console.log("\nDry run only. Add --apply to link them.");
    return;
  }

  let linked = 0;
  for (const e of unlinked) {
    const productId = e.build?.product?.id;
    if (!productId) continue;
    // Conditional, so a second run (or a concurrent fix) never overwrites a link
    const done = await prisma.stockEntry.updateMany({
      where: { id: e.id, productId: null },
      data: { productId },
    });
    linked += done.count;
  }
  console.log(`\nLinked ${linked} entr${linked === 1 ? "y" : "ies"}.`);
}

main()
  .catch((e) => {
    console.error("Failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
