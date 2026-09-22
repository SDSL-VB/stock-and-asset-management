import { PrismaClient } from "@prisma/client";
import { del, list } from "@vercel/blob";

/**
 * Start the data over, keeping the people.
 *
 * Empties everything the business has recorded — catalog, vendors, clients,
 * stock, builds, buying, dispatch, the activity log and the recycle bin — and
 * keeps who can sign in and what they may do: users, roles, permissions, grants,
 * sites and departments, plus the stored settings (approval flow, attachment
 * types, catalog rules, BOM and procurement flows), which no page can recreate
 * while Configuration is taken out.
 *
 *   npx tsx --env-file=.env prisma/reset-keep-people.ts
 *       Dry run: says which database, counts what would go and what stays, and
 *       lists the uploaded files. Changes nothing.
 *   … --apply
 *       Empties the WIPE tables, in one statement — all or nothing.
 *   … --apply --delete-files
 *       Also deletes every file in the Vercel Blob store (invoices and other
 *       stock documents). Leave this off when testing against a copy of the
 *       database: the copy still shares the live store.
 *
 * Every table must be named in WIPE or KEEP. One that is in neither — a table
 * added later — stops the script, so nothing is emptied by accident. And no
 * CASCADE is used: if a kept table ever points at a wiped one, Postgres
 * refuses instead of silently emptying the kept table too.
 *
 * Take a backup first (docs/hosting.md, "Take a dump from Neon").
 */

const WIPE = [
  // History
  "activity_logs",
  "deleted_records",
  "notifications",
  "login_failures",
  "system_state",
  // Catalog and partners
  "product_categories",
  "product_subcategories",
  "products",
  "product_requests",
  "product_vendors",
  "vendors",
  "clients",
  // Stock
  "deliveries",
  "stock_entries",
  "stock_approvals",
  "stock_entry_attachments",
  "stock_entry_warranties",
  "stock_issues",
  "stock_transfer_requests",
  "stock_write_offs",
  "stock_levels",
  // Making
  "bills_of_materials",
  "bom_lines",
  "builds",
  "build_consumptions",
  // Buying
  "purchase_intents",
  "need_lists",
  "purchase_orders",
  "purchase_order_lines",
  // Leaving
  "dispatches",
  "dispatch_items",
  "site_requests",
];

const KEEP = [
  // People and what they may do
  "users",
  "roles",
  "user_roles",
  "permissions",
  "role_permissions",
  "user_permissions",
  // Where they work
  "locations",
  "departments",
  // Stored settings
  "approval_flow_configs",
  "approval_flow_steps",
  "attachment_type_configs",
  "stock_entry_field_configs",
  "catalog_config",
  "bom_flow_config",
  "procurement_flow_config",
  // Prisma's own record of applied migrations
  "_prisma_migrations",
];

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const deleteFiles = process.argv.includes("--delete-files");

async function counts(tables: string[]) {
  const rows: { table: string; rows: number }[] = [];
  for (const table of tables) {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${table}"`);
    rows.push({ table, rows: n });
  }
  return rows;
}

/** Every file in the Blob store, following the pages. */
async function allBlobs() {
  const found: { url: string; pathname: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ cursor, limit: 1000 });
    found.push(...page.blobs.map((b) => ({ url: b.url, pathname: b.pathname })));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return found;
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgresql://unset").host;
  console.log(`Database: ${host}`);
  console.log(apply ? "Mode: APPLY" : "Mode: dry run (nothing will change)");

  // Refuse to guess about a table nobody has classified
  const tables = (
    await prisma.$queryRawUnsafe<{ t: string }[]>(`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public'`)
  ).map((r) => r.t);
  const unknown = tables.filter((t) => !WIPE.includes(t) && !KEEP.includes(t));
  const missing = [...WIPE, ...KEEP].filter((t) => !tables.includes(t));
  if (unknown.length || missing.length) {
    console.error(`Stopped. Not classified: ${unknown.join(", ") || "none"}. Listed but absent: ${missing.join(", ") || "none"}.`);
    process.exit(1);
  }

  console.log("\nWill be emptied:");
  console.table(await counts(WIPE));
  console.log("Will be kept:");
  console.table(await counts(KEEP));

  const blobs = process.env.BLOB_READ_WRITE_TOKEN ? await allBlobs() : null;
  if (blobs === null) console.log("Files: no BLOB_READ_WRITE_TOKEN, so the Blob store was not read.");
  else {
    console.log(`Files in the Blob store: ${blobs.length}`);
    for (const b of blobs) console.log(`  ${b.pathname}`);
  }

  if (!apply) {
    console.log("\nDry run only. Add --apply to empty the tables, and --delete-files to delete the files too.");
    return;
  }

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${WIPE.map((t) => `"${t}"`).join(", ")}`);
  console.log("\nTables emptied. Afterwards:");
  console.table((await counts(WIPE)).filter((r) => r.rows > 0));

  if (deleteFiles && blobs?.length) {
    for (let i = 0; i < blobs.length; i += 100) await del(blobs.slice(i, i + 100).map((b) => b.url));
    console.log(`Deleted ${blobs.length} file(s) from the Blob store. Left: ${(await allBlobs()).length}`);
  }
}

main()
  .catch((e) => {
    console.error("Failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
