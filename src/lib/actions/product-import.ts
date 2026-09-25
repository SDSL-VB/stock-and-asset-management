"use server";

import { prisma } from "@/lib/prisma";
import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { readCsvTable, cell } from "@/lib/csv-import";
import {
  PRODUCT_IMPORT_REQUIRED,
  PRODUCT_IMPORT_ALIASES,
  CATEGORY_IMPORT_REQUIRED,
  CATEGORY_IMPORT_ALIASES,
  OTHER_IMPORTS,
} from "@/lib/import-formats";
import { categoryCodeError, SUBCATEGORY_CODE_PATTERN } from "@/lib/product-codes";
import { PRODUCT_KINDS, isMadeKind, labelOfKind } from "@/lib/vocabulary";
import { composeProductCode, applyNameTag, sequenceSuffix } from "@/lib/product-codes";
import { getCatalogRules } from "./catalog-config";
import { logActivity } from "@/lib/activity-log";
import { revalidatePath } from "next/cache";

/**
 * FLOW: adding a lot of the catalog at once, from a spreadsheet — categories
 * and their subcategories, and products.
 *
 *   1. (download the template)  src/lib/import-formats.ts says what it holds —
 *                               the same questions the product form asks.
 *   2. checkProductImport       reads the file and says, row by row, what would
 *                               happen. Nothing is written. This is what the
 *                               upload dialog shows before anybody commits.
 *   3. importProducts           does it, skipping the rows that were already
 *                               wrong, in one transaction per row.
 *
 * Checking and importing share one function, so the preview cannot promise
 * something the import then refuses — the only difference between them is
 * whether the writes happen.
 *
 * Every rule the ordinary form applies still applies here: the category must
 * exist and carry a code, the subcategory must belong to it, the catalog's own
 * rules are enforced, the name takes its subcategory's tag, and the code is the
 * next number in that subcategory. A spreadsheet is a faster way to answer the
 * same questions, never a way around them.
 *
 * Subcategories are NOT created from a file. Naming one that does not exist is
 * an error naming it, because a typo would otherwise quietly become a new
 * subcategory and a whole new numbering sequence.
 */

/** What one row of the file would do, or why it cannot. */
export type ImportRowResult = {
  /** 1-based, counting the heading as row 1, so it matches the spreadsheet */
  line: number;
  name: string;
  /** The code it was given, or would be given */
  code: string | null;
  status: "ready" | "imported" | "error";
  message: string;
};

const KIND_WORDS: Record<string, string> = {
  raw: "RAW",
  rawmaterial: "RAW",
  finished: "FINISHED",
  finishedproduct: "FINISHED",
  kit: "KIT",
  readygoods: "KIT",
};

export async function checkProductImport(csvText: string) {
  return runImport(csvText, { apply: false });
}

export async function importProducts(csvText: string) {
  return runImport(csvText, { apply: true });
}

async function runImport(
  csvText: string,
  options: { apply: boolean }
): Promise<{ rows: ImportRowResult[]; imported: number } | { error: string }> {
  const user = await requireAnyPermission([
    PERMISSIONS.PRODUCTS_CREATE,
    PERMISSIONS.PRODUCTS_CREATE_MADE,
  ]);

  if (typeof csvText !== "string" || csvText.length > 2_000_000) {
    return { error: "That file is too big to read here — split it into smaller ones" };
  }

  const read = readCsvTable(csvText, PRODUCT_IMPORT_REQUIRED, PRODUCT_IMPORT_ALIASES, OTHER_IMPORTS.products);
  if ("error" in read) return read;
  const { rows } = read.table;
  if (rows.length > 500) {
    return { error: `That file has ${rows.length} rows; import at most 500 at a time` };
  }

  const [categories, rules] = await Promise.all([
    prisma.productCategory.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        codePrefix: true,
        subcategories: {
          where: { isActive: true },
          select: { id: true, name: true, code: true },
        },
      },
    }),
    getCatalogRules(),
  ]);

  const byName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]));
  const results: ImportRowResult[] = [];
  let imported = 0;

  for (const [i, row] of rows.entries()) {
    const line = i + 2;
    const name = cell(row, "Name");
    const fail = (message: string) =>
      results.push({ line, name: name || "(no name)", code: null, status: "error", message });

    if (!name) {
      fail("No name");
      continue;
    }

    const category = byName.get(cell(row, "Category").toLowerCase());
    if (!category) {
      fail(`No category called "${cell(row, "Category")}"`);
      continue;
    }
    if (!category.codePrefix) {
      fail(`${category.name} has no category code yet, so it cannot hand out product codes`);
      continue;
    }

    const wantedSub = cell(row, "Subcategory");
    const subcategory = wantedSub
      ? category.subcategories.find((s) => s.name.trim().toLowerCase() === wantedSub.toLowerCase())
      : undefined;
    if (wantedSub && !subcategory) {
      fail(`${category.name} has no subcategory called "${wantedSub}" — add it first`);
      continue;
    }
    if (rules.requireSubcategory && category.subcategories.length > 0 && !subcategory) {
      fail("This catalog requires a subcategory");
      continue;
    }

    const description = cell(row, "Description");
    if (rules.requireDescription && !description) {
      fail("This catalog requires a description");
      continue;
    }

    const kindWord = cell(row, "Kind").toLowerCase().replace(/[\s_-]+/g, "");
    const kind = (kindWord ? KIND_WORDS[kindWord] : "RAW") as (typeof PRODUCT_KINDS)[number] | undefined;
    if (!kind || !PRODUCT_KINDS.includes(kind)) {
      fail(`"${cell(row, "Kind")}" is not a kind — use RAW, FINISHED or KIT`);
      continue;
    }
    // Made and bought are separate grants, here exactly as on the form
    const needed = isMadeKind(kind) ? PERMISSIONS.PRODUCTS_CREATE_MADE : PERMISSIONS.PRODUCTS_CREATE;
    if (!user.permissions.includes(needed)) {
      fail(`Adding a ${labelOfKind(kind).toLowerCase()} needs a permission you do not have`);
      continue;
    }

    const finalName = applyNameTag(name, subcategory?.name);
    const clash = await prisma.product.findFirst({
      where: { name: finalName, categoryId: category.id },
      select: { code: true },
    });
    if (clash) {
      fail(`${finalName} already exists in ${category.name} as ${clash.code}`);
      continue;
    }

    if (!options.apply) {
      // The number it WOULD get. Not reserved — two dry runs show the same one,
      // and the import itself allocates properly inside its transaction.
      const next = subcategory
        ? (await prisma.productSubcategory.findUnique({
            where: { id: subcategory.id },
            select: { nextSequence: true },
          }))?.nextSequence ?? 1
        : (await prisma.productCategory.findUnique({
            where: { id: category.id },
            select: { nextSequence: true },
          }))?.nextSequence ?? 1;
      results.push({
        line,
        name: finalName,
        code: composeProductCode(category.codePrefix, subcategory?.code, sequenceSuffix(next)),
        status: "ready",
        message: subcategory ? `${category.name} → ${subcategory.name}` : category.name,
      });
      continue;
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const n = subcategory
          ? (
              await tx.productSubcategory.update({
                where: { id: subcategory.id },
                data: { nextSequence: { increment: 1 } },
                select: { nextSequence: true },
              })
            ).nextSequence - 1
          : (
              await tx.productCategory.update({
                where: { id: category.id },
                data: { nextSequence: { increment: 1 } },
                select: { nextSequence: true },
              })
            ).nextSequence - 1;

        const code = composeProductCode(category.codePrefix!, subcategory?.code, sequenceSuffix(n));
        if (await tx.product.findUnique({ where: { code }, select: { id: true } })) {
          throw new Error(`TAKEN:${code}`);
        }

        return tx.product.create({
          data: {
            code,
            name: finalName,
            description: description || null,
            categoryId: category.id,
            subcategoryId: subcategory?.id ?? null,
            kind,
            unit: cell(row, "Unit") || "pcs",
          },
        });
      });

      imported++;
      results.push({
        line,
        name: created.name,
        code: created.code,
        status: "imported",
        message: subcategory ? `${category.name} → ${subcategory.name}` : category.name,
      });
    } catch (e) {
      const message = e instanceof Error && e.message.startsWith("TAKEN:")
        ? `${e.message.slice(6)} is already taken — run the check again`
        : "Could not be added";
      fail(message);
    }
  }

  if (options.apply && imported > 0) {
    await logActivity(
      "CREATED",
      "Product",
      undefined,
      `Imported ${imported} product${imported === 1 ? "" : "s"} from a file`
    );
    revalidatePath("/stock/products");
  }

  return { rows: results, imported };
}

/* ------------------------------------------------------------------------- */
/* Categories and their subcategories                                        */
/* ------------------------------------------------------------------------- */

/**
 * The same three steps as products: take the template, see what the file would
 * do, then do it.
 *
 * One row is one SUBCATEGORY under a category, so a category with four
 * subcategories is four rows naming it. A row with the subcategory columns
 * blank creates the category alone. Naming a category that already exists adds
 * to it rather than complaining — which is how a second batch of subcategories
 * is added later.
 *
 * Every rule the Categories tab applies still applies: the category code is
 * letters and digits within the configured length and unique, a subcategory
 * code is letters and digits, unique within its category, and required when
 * Catalog settings says so. Clashes WITHIN the file are caught too, because
 * two rows asking for the same code would otherwise let the first through and
 * fail the second for no reason a reader could see.
 */
export async function checkCategoryImport(csvText: string) {
  return runCategoryImport(csvText, { apply: false });
}

export async function importCategories(csvText: string) {
  return runCategoryImport(csvText, { apply: true });
}

async function runCategoryImport(
  csvText: string,
  options: { apply: boolean }
): Promise<{ rows: ImportRowResult[]; imported: number } | { error: string }> {
  await requireAnyPermission([PERMISSIONS.CATEGORIES_CREATE]);

  if (typeof csvText !== "string" || csvText.length > 1_000_000) {
    return { error: "That file is too big to read here — split it into smaller ones" };
  }

  const read = readCsvTable(csvText, CATEGORY_IMPORT_REQUIRED, CATEGORY_IMPORT_ALIASES, OTHER_IMPORTS.categories);
  if ("error" in read) return read;
  const { rows, headings } = read.table;

  // A products list also has a Category column, so it gets this far. It is
  // recognised by what it does NOT have: a category code or a subcategory.
  // Without this it would be read as "these categories already exist" nine
  // times over, which says nothing about the real mistake.
  const named = headings.map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ""));
  if (named.includes("name") && !named.includes("categorycode") && !named.includes("subcategory")) {
    return { error: "That file is a products list — upload it on the Procured or Made tab instead." };
  }

  if (rows.length > 200) {
    return { error: `That file has ${rows.length} rows; import at most 200 at a time` };
  }

  const [existing, rules] = await Promise.all([
    prisma.productCategory.findMany({
      select: {
        id: true,
        name: true,
        codePrefix: true,
        subcategories: { select: { name: true, code: true } },
      },
    }),
    getCatalogRules(),
  ]);

  /**
   * The catalog as this file will leave it: what is in the database, plus what
   * earlier rows have already asked for. Both the dry run and the import keep
   * it up to date, which is what makes the preview honest — a row that adds a
   * subcategory to a category created three rows above reads as ready in both,
   * and a row that repeats a code is refused in both.
   */
  type Known = {
    /** Null for one this file creates — it has no id until the import runs */
    id: string | null;
    codePrefix: string | null;
    subNames: Set<string>;
    subCodes: Set<string>;
  };
  const known = new Map<string, Known>(
    existing.map((c) => [
      c.name.trim().toLowerCase(),
      {
        id: c.id,
        codePrefix: c.codePrefix,
        subNames: new Set(c.subcategories.map((s) => s.name.trim().toLowerCase())),
        subCodes: new Set(c.subcategories.map((s) => s.code).filter(Boolean) as string[]),
      },
    ])
  );
  const takenCodes = new Set(existing.map((c) => c.codePrefix).filter(Boolean) as string[]);

  const results: ImportRowResult[] = [];
  let imported = 0;

  for (const [i, row] of rows.entries()) {
    const line = i + 2;
    const categoryName = cell(row, "Category").trim();
    const categoryCode = cell(row, "Category Code").trim().toUpperCase();
    const subName = cell(row, "Subcategory").trim();
    const subCode = cell(row, "Subcategory Code").trim().toUpperCase();
    const label = subName ? `${categoryName} → ${subName}` : categoryName;
    const fail = (message: string) =>
      results.push({ line, name: label || "(no category)", code: null, status: "error", message });

    if (!categoryName) {
      fail("No category name");
      continue;
    }

    const key = categoryName.toLowerCase();
    const already = known.get(key);

    // ---- the category itself ----
    if (!already) {
      if (!categoryCode) {
        fail(`${categoryName} is new, so it needs a category code`);
        continue;
      }
      const codeProblem = categoryCodeError(categoryCode, rules.categoryCodeLength);
      if (codeProblem) {
        fail(codeProblem);
        continue;
      }
      if (takenCodes.has(categoryCode)) {
        fail(`Code ${categoryCode} is already used by another category`);
        continue;
      }
    } else if (categoryCode && already.codePrefix && categoryCode !== already.codePrefix) {
      fail(`${categoryName} already has the code ${already.codePrefix} — leave the code blank to add to it`);
      continue;
    }

    // ---- the subcategory, when there is one ----
    if (subName) {
      if (already?.subNames.has(subName.toLowerCase())) {
        fail(`${categoryName} already has a subcategory called ${subName}`);
        continue;
      }
      if (subCode && !SUBCATEGORY_CODE_PATTERN.test(subCode)) {
        fail(`"${subCode}" is not a subcategory code — use 1 to 8 letters or digits`);
        continue;
      }
      if (rules.requireSubcategoryCode && !subCode) {
        fail("This catalog requires every subcategory to have a code");
        continue;
      }
      if (subCode && already?.subCodes.has(subCode)) {
        fail(`${categoryName} already uses the subcategory code ${subCode}`);
        continue;
      }
    } else if (already) {
      fail(`${categoryName} already exists, and this row adds no subcategory`);
      continue;
    }

    const what = already
      ? `Adds ${subName}${subCode ? ` (${subCode})` : ""} to ${categoryName}`
      : subName
        ? `Creates ${categoryName} (${categoryCode}) with ${subName}${subCode ? ` (${subCode})` : ""}`
        : `Creates ${categoryName} (${categoryCode})`;

    // What the rows after this one will find, whichever mode this is
    const remember = () => {
      const entry =
        already ??
        (() => {
          const fresh: Known = { id: null, codePrefix: categoryCode, subNames: new Set(), subCodes: new Set() };
          known.set(key, fresh);
          takenCodes.add(categoryCode);
          return fresh;
        })();
      if (subName) {
        entry.subNames.add(subName.toLowerCase());
        if (subCode) entry.subCodes.add(subCode);
      }
      return entry;
    };

    if (!options.apply) {
      remember();
      results.push({
        line,
        name: label,
        code: already?.codePrefix ?? categoryCode,
        status: "ready",
        message: what,
      });
      continue;
    }

    try {
      if (already?.id) {
        await prisma.productSubcategory.create({
          data: { categoryId: already.id, name: subName, code: subCode || null },
        });
        remember();
      } else {
        const created = await prisma.productCategory.create({
          data: {
            name: categoryName,
            codePrefix: categoryCode,
            subcategories: subName ? { create: [{ name: subName, code: subCode || null }] } : undefined,
          },
          select: { id: true },
        });
        // Later rows naming it add to it rather than trying to create it again
        const entry = remember();
        entry.id = created.id;
      }
      imported++;
      results.push({ line, name: label, code: already?.codePrefix ?? categoryCode, status: "imported", message: what });
    } catch {
      fail("Could not be added");
    }
  }

  if (options.apply && imported > 0) {
    await logActivity(
      "CREATED",
      "ProductCategory",
      undefined,
      `Imported ${imported} catalog row${imported === 1 ? "" : "s"} (categories and subcategories) from a file`
    );
    revalidatePath("/stock/products");
  }

  return { rows: results, imported };
}
