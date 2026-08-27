/**
 * Loads a bill of materials out of a spreadsheet.
 *
 * The sheets people actually keep are not tidy: the header sits on row 1 or
 * row 2, "Category" is sometimes a word and sometimes an internal number, a
 * quantity reads "25 Mtrs", and some rows are notes rather than parts. So this
 * script does not guess silently — it **reports every row it could not read**
 * and, unless you pass --apply, changes nothing at all.
 *
 * Read the report, fix the sheet or the flags, then run it again with --apply.
 *
 *   npx tsx prisma/import-bom.ts --file BLDC_Robotic_BOM.xlsx --sheet "Electrical" --for 1001-BLDC340
 *   npx tsx prisma/import-bom.ts --file BLDC_Robotic_BOM.xlsx --sheet "Electrical" --for 1001-BLDC340 --category Electricals --apply
 *
 * Flags:
 *   --file      path to the .xlsx                                   (required)
 *   --sheet     sheet name; omit to list the sheets                 (required to import)
 *   --for       code of the product this bill of materials belongs to          (required to import)
 *   --category  category for components this script has to create   (default: the parent's)
 *   --author    email of the user recorded as publishing it         (default: first Super Admin)
 *   --apply     actually write. Without it, nothing is written.
 */
import { PrismaClient } from "@prisma/client";
import { readWorkbook } from "./lib/read-workbook";

const prisma = new PrismaClient();

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

/** Column headers we recognise, lowercased and stripped of punctuation */
const NAME_HEADERS = ["particulars", "material", "description", "descrioptio", "item", "part"];
const QTY_HEADERS = ["qty per unit", "quantity per unit", "qty", "quantity"];
const CATEGORY_HEADERS = ["category"];
const UNIT_HEADERS = ["unit", "uom"];

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/** "25 Mtrs" → { qty: 25, unit: "Mtrs" } · "2.0" → { qty: 2, unit: null } */
function parseQuantity(raw: string): { qty: number; unit: string | null } | null {
  const m = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(.*)$/.exec(raw.trim());
  if (!m) return null;
  const qty = Number(m[1]);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const unit = m[2].trim();
  return { qty, unit: unit ? unit : null };
}

type Parsed = {
  row: number;
  name: string;
  qty: number;
  unit: string;
  category: string | null;
};

async function main() {
  const file = flag("file");
  if (!file) {
    console.error("Pass --file <path to .xlsx>");
    process.exit(1);
  }

  const sheets = readWorkbook(file);
  const sheetName = flag("sheet");

  if (!sheetName) {
    console.log(`Sheets in ${file}:\n`);
    for (const s of sheets) console.log(`  ${s.name}  (${s.rows.length} rows)`);
    console.log("\nRe-run with --sheet \"<name>\" --for <product code>");
    return;
  }

  const sheet = sheets.find((s) => s.name === sheetName);
  if (!sheet) {
    console.error(`No sheet called "${sheetName}". Available: ${sheets.map((s) => s.name).join(", ")}`);
    process.exit(1);
  }

  // --- find the header row -------------------------------------------------
  let headerRow = -1;
  let cols = { name: -1, qty: -1, category: -1, unit: -1 };

  for (let i = 0; i < Math.min(sheet.rows.length, 10); i++) {
    const cells = sheet.rows[i].map(normalise);
    const find = (candidates: string[]) =>
      cells.findIndex((c) => c && candidates.some((h) => c === h || c.startsWith(h)));

    const name = find(NAME_HEADERS);
    const qty = find(QTY_HEADERS);
    if (name >= 0 && qty >= 0) {
      headerRow = i;
      cols = { name, qty, category: find(CATEGORY_HEADERS), unit: find(UNIT_HEADERS) };
      break;
    }
  }

  if (headerRow < 0) {
    console.error(
      `Could not find a header row in "${sheetName}". It needs a column named one of ` +
        `[${NAME_HEADERS.join(", ")}] and one of [${QTY_HEADERS.join(", ")}].`
    );
    process.exit(1);
  }

  console.log(`Sheet "${sheetName}": header on row ${headerRow + 1}`);
  console.log(
    `  name → column ${cols.name + 1}, quantity → column ${cols.qty + 1}` +
      (cols.category >= 0 ? `, category → column ${cols.category + 1}` : "") +
      (cols.unit >= 0 ? `, unit → column ${cols.unit + 1}` : "") +
      "\n"
  );

  // --- read the rows -------------------------------------------------------
  const parsed: Parsed[] = [];
  const skipped: { row: number; why: string; cells: string[] }[] = [];

  for (let i = headerRow + 1; i < sheet.rows.length; i++) {
    const cells = sheet.rows[i];
    if (!cells || cells.every((c) => !c?.trim())) continue;

    const name = (cells[cols.name] ?? "").trim();
    const rawQty = (cells[cols.qty] ?? "").trim();

    if (!name) {
      skipped.push({ row: i + 1, why: "no part name in that column", cells });
      continue;
    }
    if (!rawQty) {
      skipped.push({ row: i + 1, why: `"${name}" has no quantity`, cells });
      continue;
    }

    const q = parseQuantity(rawQty);
    if (!q) {
      skipped.push({ row: i + 1, why: `"${name}" has an unreadable quantity "${rawQty}"`, cells });
      continue;
    }

    const explicitUnit = cols.unit >= 0 ? (cells[cols.unit] ?? "").trim() : "";
    const rawCategory = cols.category >= 0 ? (cells[cols.category] ?? "").trim() : "";
    // A "category" that is just a number is this workbook's internal id, not a
    // category name — ignore it rather than creating a category called "228"
    const category = rawCategory && !/^\d+(\.\d+)?$/.test(rawCategory) ? rawCategory : null;

    parsed.push({
      row: i + 1,
      name,
      qty: q.qty,
      unit: explicitUnit || q.unit || "pcs",
      category,
    });
  }

  // Two rows naming the same part is a real thing in these sheets
  const byName = new Map<string, Parsed>();
  const merged: string[] = [];
  for (const p of parsed) {
    const key = p.name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      existing.qty += p.qty;
      merged.push(`row ${p.row}: "${p.name}" combined into row ${existing.row} (now ${existing.qty})`);
    } else {
      byName.set(key, p);
    }
  }
  const lines = [...byName.values()];

  console.log(`Read ${lines.length} component${lines.length === 1 ? "" : "s"}:`);
  for (const l of lines) {
    console.log(
      `  ${String(l.qty).padStart(8)} ${l.unit.padEnd(6)} ${l.name}` +
        (l.category ? `   [${l.category}]` : "")
    );
  }
  if (merged.length) {
    console.log(`\nCombined duplicate rows:`);
    merged.forEach((m) => console.log(`  ${m}`));
  }
  if (skipped.length) {
    console.log(`\nCould not read ${skipped.length} row${skipped.length === 1 ? "" : "s"}:`);
    skipped.forEach((s) => console.log(`  row ${s.row}: ${s.why}`));
  }

  const parentCode = flag("for");
  if (!parentCode) {
    console.log(`\nPass --for <product code> to attach this as that product's bill of materials.`);
    return;
  }

  // --- resolve the parent, the category and the author ---------------------
  const parent = await prisma.product.findUnique({
    where: { code: parentCode },
    include: { category: true },
  });
  if (!parent) {
    console.error(`\nNo product with code "${parentCode}". Create it in the catalog first.`);
    process.exit(1);
  }

  const categoryName = flag("category");
  const fallbackCategory = categoryName
    ? await prisma.productCategory.findFirst({ where: { name: categoryName } })
    : parent.category;

  if (!fallbackCategory) {
    console.error(`\nNo category called "${categoryName}".`);
    process.exit(1);
  }

  const authorEmail = flag("author");
  const author = authorEmail
    ? await prisma.user.findUnique({ where: { email: authorEmail } })
    : await prisma.user.findFirst({ where: { role: { name: "Super Admin" } } });

  if (!author) {
    console.error(`\nNo user to record as the author. Pass --author <email>.`);
    process.exit(1);
  }

  // --- match each line to a product ---------------------------------------
  const categories = await prisma.productCategory.findMany();
  const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));

  const existing = await prisma.product.findMany({
    select: { id: true, code: true, name: true, categoryId: true },
  });
  const productByName = new Map(existing.map((p) => [p.name.toLowerCase(), p]));

  const toCreate = lines.filter((l) => !productByName.has(l.name.toLowerCase()));
  const matched = lines.length - toCreate.length;

  console.log(`\nAgainst the catalog: ${matched} already exist, ${toCreate.length} would be created.`);
  if (toCreate.length) {
    console.log(`\nWould create:`);
    for (const l of toCreate) {
      const cat = (l.category && categoryByName.get(l.category.toLowerCase())) || fallbackCategory;
      console.log(`  ${l.name}  (${cat.name}, measured in ${l.unit})`);
    }
  }

  console.log(
    `\nRecipe for ${parent.code} ${parent.name} would have ${lines.length} component${lines.length === 1 ? "" : "s"}.`
  );

  if (!has("apply")) {
    console.log(`\nDry run — nothing was written. Re-run with --apply to commit.`);
    return;
  }

  // --- write ---------------------------------------------------------------
  await prisma.$transaction(async (tx) => {
    // Create the missing products, giving each a code from its category prefix
    const nextSuffix = new Map<string, number>();

    for (const l of toCreate) {
      const cat = (l.category && categoryByName.get(l.category.toLowerCase())) || fallbackCategory;

      let prefix = cat.codePrefix;
      if (!prefix) {
        const highest = (await tx.productCategory.findMany({ where: { codePrefix: { not: null } } }))
          .reduce((max, c) => Math.max(max, Number(c.codePrefix) || 0), 1000);
        prefix = String(highest + 1);
        await tx.productCategory.update({ where: { id: cat.id }, data: { codePrefix: prefix } });
        cat.codePrefix = prefix;
      }

      // Continue the numbering already in use for that prefix
      if (!nextSuffix.has(prefix)) {
        const used = await tx.product.findMany({
          where: { code: { startsWith: `${prefix}-` } },
          select: { code: true },
        });
        const highest = used.reduce((max, p) => {
          const n = Number(p.code.split("-")[1]);
          return Number.isFinite(n) && n > max ? n : max;
        }, 0);
        nextSuffix.set(prefix, highest + 1);
      }

      const n = nextSuffix.get(prefix)!;
      nextSuffix.set(prefix, n + 1);

      const created = await tx.product.create({
        data: {
          code: `${prefix}-${String(n).padStart(4, "0")}`,
          name: l.name,
          categoryId: cat.id,
          kind: "RAW",
          unit: l.unit,
        },
      });
      productByName.set(l.name.toLowerCase(), created);
      console.log(`  created ${created.code}  ${created.name}`);
    }

    const highestVersion = await tx.billOfMaterials.findFirst({
      where: { productId: parent.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (highestVersion?.version ?? 0) + 1;

    await tx.billOfMaterials.updateMany({
      where: { productId: parent.id, isActive: true },
      data: { isActive: false },
    });

    await tx.billOfMaterials.create({
      data: {
        productId: parent.id,
        version,
        isActive: true,
        notes: `Imported from ${file} · sheet "${sheetName}"`,
        createdById: author.id,
        lines: {
          create: lines.map((l, i) => ({
            componentProductId: productByName.get(l.name.toLowerCase())!.id,
            quantityPerUnit: l.qty,
            displayOrder: i,
          })),
        },
      },
    });

    await tx.activityLog.create({
      data: {
        userId: author.id,
        action: "CREATED",
        entity: "BillOfMaterials",
        entityId: parent.id,
        details: `Imported version ${version} of the bill of materials for ${parent.code} from ${sheetName} — ${lines.length} components`,
      },
    });

    console.log(`\nPublished version ${version} of the bill of materials for ${parent.code}.`);
  });
}

main()
  .catch((e) => {
    console.error("\nImport failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
