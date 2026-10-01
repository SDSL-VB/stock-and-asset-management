"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission, requireAnyPermission } from "@/lib/rbac/check";
import {
  PERMISSIONS,
  BOM_PERMISSIONS,
  BUILDS_PAGE_PERMISSIONS,
  resolveStockScope,
} from "@/lib/rbac/permissions";
import { NO_SITE } from "@/lib/stock-visibility";
import { builtGoodsRefusal } from "@/lib/review-rules";
import { builtGoodsWaiting } from "@/lib/notifications/events";
import {
  availableQuantity,
  availabilityInclude,
  availableFromIssue,
  issueDrawdownsInclude,
  round,
} from "@/lib/stock-availability";
import { buildSchema } from "@/lib/validations/bom";
import { unitsFromLine, unitsSupported } from "@/lib/build-readiness";
import { onTheWay } from "@/lib/low-stock";
import { syncBomWatches } from "@/lib/low-stock-bom";
import { after } from "next/server";
import { logActivity } from "@/lib/activity-log";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { lockIssues } from "@/lib/stock-locks";

/**
 * FLOW: making something — components out, finished product in.
 *
 *   1. createBuild        a published bill of materials plus a quantity. The
 *                         components leave the BUILDER'S DEPARTMENT stock (never
 *                         its assets) IMMEDIATELY, oldest first, whether the
 *                         work finishes today or not. What the department lacks
 *                         is requested from central stock first (materials.ts).
 *                         "Build now" completes at once; "Start work" leaves the
 *                         run ON THE FLOOR — counted, visible, not dispatchable.
 *   2. finishBuild        books finished units into central stock. They WAIT
 *                         for whoever approves built goods (bom.build.approve)
 *                         unless that person finished them. Can be called
 *                         repeatedly: start 10, finish 6, and 4 stay on the
 *                         floor. How many are finished is never stored — it is
 *                         the sum of the entries produced, so the two numbers
 *                         cannot drift.
 *      approveBuiltGoods  makes waiting units stock; returnBuiltGoods sends
 *                         them back to the floor.
 *      closeBuildShort    ends a run that will not be completed. The components
 *                         for the shortfall stay consumed: they are in scrap or
 *                         half-built units, not back on the shelf.
 *      reverseBuild       undoes it entirely, but only while nothing has been
 *                         moved or dispatched from any batch it produced.
 *
 * Only the TOP level is consumed. A component with its own bill of materials is
 * expected to have been built already — building the whole tree in one press
 * would consume things nobody agreed to consume.
 */

/**
 * Building is the verb a bill of materials was missing.
 *
 * Components genuinely leave the department's stock and the assembled product
 * genuinely arrives as an ordinary stock entry in central stock — which is why
 * dispatch needs no special case for it, and why whatever was left over still
 * shows as itself.
 */

/**
 * What one unit needs, and whether the location can supply it.
 *
 * Only the top level is consumed. A component with a bill of materials of its
 * own is expected to have been built already and to be sitting in stock as
 * itself; building the whole tree in one press would silently consume things
 * nobody agreed to consume.
 */
export async function getBuildReadiness(productId: string, quantity: number, locationId: string) {
  const user = await requireAnyPermission(BOM_PERMISSIONS);

  // The same site rule createBuild enforces. The site arrives from the browser,
  // and without this a person tied to Bengaluru could ask about Hyderabad and
  // read its component stock — and its value — without being able to build
  // there. Refusing to answer is the only way to stop a question leaking what
  // the person could not otherwise see.
  const scope = resolveStockScope(user);
  if (scope !== "all" && user.locationId !== locationId) {
    return { ok: false as const, error: "You can only check stock at your own site" };
  }
  // A build draws on the builder's own department stock
  const department = await buildingDepartment(user, locationId);
  if ("error" in department) return { ok: false as const, error: department.error };

  const bom = await prisma.billOfMaterials.findFirst({
    where: { productId, isActive: true, status: "PUBLISHED" },
    include: {
      lines: {
        include: { component: { include: { category: { select: { name: true } } } } },
        orderBy: { displayOrder: "asc" },
      },
      product: { select: { id: true, code: true, name: true, unit: true } },
    },
  });

  // Tagged so the union narrows across the server-action boundary — without a
  // literal discriminant, `"error" in res` leaves every field optional.
  if (!bom) return { ok: false as const, error: "This product has no published bill of materials" };
  if (bom.lines.length === 0)
    return { ok: false as const, error: "That bill of materials has no components" };

  const canSeeValue = user.permissions.includes(PERMISSIONS.STOCK_VALUE_VIEW);
  const wanted = Math.max(1, Math.floor(quantity));

  // Already asked for or ordered for this site — so "Request what's short"
  // only offers what nobody has asked for yet, and reads "Requested" once done
  const coming = await onTheWay(bom.lines.map((l) => l.componentProductId), [locationId]);

  const allLines = await Promise.all(
    bom.lines.map(async (line) => {
      const holdings = await holdingsFor(line.componentProductId, department.id);
      const available = round(holdings.reduce((sum, h) => sum + availableFromIssue(h), 0));
      const needed = round(line.quantityPerUnit * wanted);

      // Value of what this line contributes, taken from the holdings that would
      // actually be drawn down
      const unitCost = holdings.length
        ? holdings.reduce((sum, h) => sum + h.stockEntry.unitPrice, 0) / holdings.length
        : 0;

      return {
        componentProductId: line.componentProductId,
        code: line.component.code,
        name: line.component.name,
        unit: line.component.unit,
        categoryName: line.component.category.name,
        perUnit: line.quantityPerUnit,
        needed,
        available,
        short: round(Math.max(0, needed - available)),
        onTheWay: round(coming.get(`${line.componentProductId}|${locationId}`) ?? 0),
        isOptional: line.isOptional,
        notes: line.notes,
        // How many complete units this one line could supply
        supports: unitsFromLine({ perUnit: line.quantityPerUnit, available }),
        estimatedCost: canSeeValue ? round(unitCost * needed) : null,
      };
    })
  );

  // The shared rule — see src/lib/build-readiness.ts. An optional line never
  // blocks a build: nobody ordered that add-on.
  const blocking = allLines.filter((l) => !l.isOptional);
  const maxBuildable = unitsSupported(
    allLines.map((l) => ({ perUnit: l.perUnit, available: l.available, isOptional: l.isOptional }))
  );

  // Someone who builds but may not read bills of materials learns only whether
  // it can be built and, if not, what is missing — never the whole recipe. Cut
  // here, so the rest never reaches their browser.
  const seesRecipe = user.permissions.includes(PERMISSIONS.BOM_VIEW);
  const lines = seesRecipe ? allLines : allLines.filter((l) => l.short > 0 && !l.isOptional);

  return {
    ok: true as const,
    bomId: bom.id,
    bomVersion: bom.version,
    product: bom.product,
    quantity: wanted,
    lines,
    departmentName: department.name,
    canBuild: blocking.every((l) => l.short === 0),
    maxBuildable,
    estimatedCost: canSeeValue
      ? round(allLines.reduce((sum, l) => sum + (l.estimatedCost ?? 0), 0))
      : null,
  };
}

/**
 * The department whose stock a build at this site draws on: the builder's own,
 * which has to be at that site. Someone in no department has no stock to build
 * from.
 */
async function buildingDepartment(
  user: { departmentId?: string | null },
  locationId: string
): Promise<{ id: string; name: string } | { error: string }> {
  if (!user.departmentId) {
    return { error: "Builds draw on your department's stock, and you are not in a department" };
  }
  const department = await prisma.department.findUnique({
    where: { id: user.departmentId },
    select: { id: true, name: true, locationId: true, isActive: true },
  });
  if (!department || !department.isActive) return { error: "Your department was not found" };
  if (department.locationId !== locationId) {
    return { error: "Your department is at another site — build where its stock is" };
  }
  return { id: department.id, name: department.name };
}

/**
 * A department's holdings of one product — stock only, never assets — oldest
 * first, with everything needed to tell how much is still free.
 */
async function holdingsFor(
  productId: string,
  departmentId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  return client.stockIssue.findMany({
    where: { departmentId, isAsset: false, stockEntry: { productId } },
    include: {
      ...issueDrawdownsInclude,
      stockEntry: { select: { id: true, unitPrice: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Numbers follow the same PREFIX-YYYYMMDD-NNN shape as every other record here,
 * counting within the day. A build number doubles as the batch number of what
 * comes out, so it has to read like one.
 */
async function nextNumber(
  prefix: string,
  lastOfDay: (p: string) => Promise<string | null>
): Promise<string> {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const stem = `${prefix}-${dateStr}-`;
  const last = await lastOfDay(stem);
  const seq = last ? parseInt(last.split("-").pop() || "0", 10) + 1 : 1;
  return `${stem}${String(seq).padStart(3, "0")}`;
}

function nextBuildNumber(tx: Prisma.TransactionClient) {
  return nextNumber("BLD", async (stem) => {
    const last = await tx.build.findFirst({
      where: { buildNumber: { startsWith: stem } },
      orderBy: { buildNumber: "desc" },
      select: { buildNumber: true },
    });
    return last?.buildNumber ?? null;
  });
}

function nextEntryNumber(tx: Prisma.TransactionClient) {
  return nextNumber("SE", async (stem) => {
    const last = await tx.stockEntry.findFirst({
      where: { entryNumber: { startsWith: stem } },
      orderBy: { entryNumber: "desc" },
      select: { entryNumber: true },
    });
    return last?.entryNumber ?? null;
  });
}

/**
 * Consumes components and books the assembled product into central stock.
 *
 * Everything happens in one transaction: either the components leave and the
 * product arrives, or neither does. A half-finished build would leave stock
 * that exists in no meaningful place.
 */
export async function createBuild(data: unknown) {
  const user = await requirePermission(PERMISSIONS.BOM_BUILD);

  const parsed = buildSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { productId, quantity, locationId, notes, batchNumber, startOnly } = parsed.data;

  // Typing a batch is its own grant, exactly as on the stock entry form — it is
  // the only place a batch is ever entered by hand.
  const canSetBatch = user.permissions.includes(PERMISSIONS.STOCK_BATCH_EDIT);
  const chosenBatch = canSetBatch ? batchNumber?.trim() : "";

  // Someone tied to one site can only build there
  const scope = resolveStockScope(user);
  if (scope !== "all" && user.locationId !== locationId) {
    return { error: "You can only build at your own site" };
  }
  // ...and from their own department's stock
  const department = await buildingDepartment(user, locationId);
  if ("error" in department) return { error: department.error };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const bom = await tx.billOfMaterials.findFirst({
        where: { productId, isActive: true, status: "PUBLISHED" },
        include: { lines: true, product: true },
      });
      if (!bom) throw new Error("SOFT:This product has no published bill of materials");
      if (bom.lines.length === 0) throw new Error("SOFT:That bill of materials has no components");

      const location = await tx.location.findUnique({ where: { id: locationId } });
      if (!location) throw new Error("SOFT:That site does not exist");

      // Hold every one of the department's holdings of these components still
      // while it is counted and drawn down, so two builds at the same moment
      // cannot use the same stock
      const candidates = await tx.stockIssue.findMany({
        where: {
          departmentId: department.id,
          isAsset: false,
          stockEntry: { productId: { in: bom.lines.map((l) => l.componentProductId) } },
        },
        select: { id: true },
      });
      await lockIssues(tx, candidates.map((c) => c.id));

      // Draw down each component from the department's stock, oldest first
      const consumptions: { stockEntryId: string; stockIssueId: string; quantity: number }[] = [];
      let rolledUpCost = 0;

      for (const line of bom.lines) {
        let remaining = round(line.quantityPerUnit * quantity);
        if (remaining <= 0) continue;

        const holdings = await holdingsFor(line.componentProductId, department.id, tx);
        const total = round(holdings.reduce((sum, h) => sum + availableFromIssue(h), 0));

        if (total < remaining) {
          if (line.isOptional) continue; // an add-on nobody ordered
          const product = await tx.product.findUnique({
            where: { id: line.componentProductId },
            select: { name: true, unit: true },
          });
          throw new Error(
            `SOFT:Not enough ${product?.name ?? "of one component"} in ${department.name} — need ${remaining} ${product?.unit ?? ""}, ${total} there. Request it from central stock.`
          );
        }

        for (const holding of holdings) {
          if (remaining <= 0) break;
          const canTake = availableFromIssue(holding);
          if (canTake <= 0) continue;

          const take = round(Math.min(canTake, remaining));
          consumptions.push({ stockEntryId: holding.stockEntry.id, stockIssueId: holding.id, quantity: take });
          rolledUpCost += take * holding.stockEntry.unitPrice;
          remaining = round(remaining - take);
        }
      }

      const buildNumber = await nextBuildNumber(tx);

      const build = await tx.build.create({
        data: {
          buildNumber,
          productId,
          bomId: bom.id,
          quantity,
          locationId,
          departmentId: department.id,
          // Starting work consumes the components and produces nothing yet —
          // the run sits on the floor until someone finishes it.
          status: startOnly ? "IN_PROGRESS" : "COMPLETED",
          completedAt: startOnly ? null : new Date(),
          notes: notes?.trim() || null,
          builtById: user.id,
          consumptions: { create: consumptions },
        },
      });

      // Cost per unit is fixed at the start, from what was actually consumed —
      // so finishing in two goes values both the same.
      const unitPrice = round(rolledUpCost / quantity);

      if (!startOnly) {
        await createOutputEntry(tx, {
          build,
          product: bom.product,
          quantity,
          unitPrice,
          locationId,
          batchNumber: chosenBatch || buildNumber,
          userId: user.id,
          approved: builtGoodsRefusal(user, { locationId }) === null,
        });
      }

      return {
        build,
        buildNumber,
        componentCount: consumptions.length,
        startOnly: !!startOnly,
      };
    });

    await logActivity(
      "CREATED",
      "Build",
      result.build.id,
      `Built ${quantity} × ${result.build.productId} as ${result.buildNumber}, consuming ${result.componentCount} stock entr${result.componentCount === 1 ? "y" : "ies"}`
    );

    revalidatePath("/bom");
    revalidatePath("/builds");
    revalidatePath("/stock");
    revalidatePath("/dispatch");
    // This site now builds the product, so its components are watched here too.
    // After the response, so the build is not held up by it.
    after(() => syncBomWatches().catch((e) => console.error("Low-stock BOM sync failed:", e)));
    return { success: true, buildNumber: result.buildNumber, buildId: result.build.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Build failed";
    if (message.startsWith("SOFT:")) return { error: message.slice(5) };
    throw e;
  }
}

/**
 * Books finished goods into central stock as an ordinary approved entry.
 *
 * Shared by "build now" and "finish some of a run in progress", so both produce
 * exactly the same kind of record — dispatch and reports never learn that a
 * staged build exists.
 */
async function createOutputEntry(
  tx: Prisma.TransactionClient,
  input: {
    build: { id: string; buildNumber: string };
    product: { id: string; code: string; name: string };
    quantity: number;
    unitPrice: number;
    locationId: string;
    batchNumber: string;
    userId: string;
    /** Finished by someone who may approve built goods: approved at once */
    approved: boolean;
  }
) {
  const entryNumber = await nextEntryNumber(tx);

  return tx.stockEntry.create({
    data: {
      entryNumber,
      // Linked to its product like every other entry. It was left unset, so
      // everything built was invisible to anything that finds stock BY product
      // — Find Stock, low stock, the site's shelf list — and a consignment of it
      // carried the missing link on to the site that received it.
      productId: input.product.id,
      itemCode: input.product.code,
      itemName: input.product.name,
      supplierName: "Built in-house",
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      totalPrice: round(input.unitPrice * input.quantity),
      locationId: input.locationId,
      // Whatever was typed, else the build number — a recall follows this
      batchNumber: input.batchNumber,
      // Waits for whoever approves built goods — it is not stock until then
      status: input.approved ? "APPROVED" : "SUBMITTED",
      departmentId: null,
      source: "BUILT",
      buildId: input.build.id,
      createdById: input.userId,
      approvedById: input.approved ? input.userId : null,
    },
  });
}

/**
 * Books some or all of a run in progress into stock.
 *
 * Finishing fewer than were started is normal — the rest stay on the floor and
 * can be finished later. How many are done is never stored; it is the sum of
 * the entries this build has produced.
 */
export async function finishBuild(buildId: string, quantity: number, batchNumber?: string) {
  const user = await requirePermission(PERMISSIONS.BOM_BUILD_FINISH);

  const build = await prisma.build.findUnique({
    where: { id: buildId },
    include: {
      product: { select: { id: true, code: true, name: true } },
      outputs: { select: { quantity: true, unitPrice: true } },
    },
  });
  if (!build) return { error: "That build does not exist" };
  if (build.status !== "IN_PROGRESS") {
    return { error: "That run is not on the floor — there is nothing left to finish" };
  }
  // A run is finished by the site it is on
  if (resolveStockScope(user) !== "all" && build.locationId !== user.locationId) {
    return { error: "That run is at another site" };
  }

  const alreadyDone = build.outputs.reduce((sum, o) => sum + o.quantity, 0);
  const outstanding = build.quantity - alreadyDone;
  const wanted = Math.floor(quantity);

  if (!Number.isFinite(wanted) || wanted < 1) return { error: "How many are finished?" };
  if (wanted > outstanding) {
    return {
      error: `Only ${outstanding} of ${build.buildNumber} are still on the floor.`,
    };
  }

  // The cost was settled when the components were consumed; every batch out of
  // this run carries the same unit price.
  const unitPrice = build.outputs[0]?.unitPrice ?? (await unitCostOf(build.id));

  const finishesIt = wanted === outstanding;
  // Typing a batch is its own grant, exactly as when starting the run
  const typedBatch = user.permissions.includes(PERMISSIONS.STOCK_BATCH_EDIT) ? batchNumber?.trim() : "";
  // Raise what you may approve: finished by the approver, approved at once
  const approved = builtGoodsRefusal(user, build) === null;

  const done = await prisma.$transaction(async (tx) => {
    // Locked and recounted: two people finishing the same run at once cannot
    // both book the same outstanding units in
    await tx.$queryRaw`SELECT id FROM builds WHERE id = ${buildId} FOR UPDATE`;
    const finishedSoFar = await tx.stockEntry.aggregate({ where: { buildId }, _sum: { quantity: true } });
    if (wanted > build.quantity - (finishedSoFar._sum.quantity ?? 0)) return false;

    await createOutputEntry(tx, {
      build,
      product: build.product,
      quantity: wanted,
      unitPrice,
      locationId: build.locationId,
      batchNumber: typedBatch || build.buildNumber,
      userId: user.id,
      approved,
    });

    if (finishesIt) {
      await tx.build.update({
        where: { id: buildId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
    return true;
  });
  if (!done) return { error: "Someone has just finished some of this run — check what is left and try again" };

  await logActivity(
    "UPDATED",
    "Build",
    buildId,
    `Finished ${wanted} of ${build.buildNumber} — ${build.product.code}${finishesIt ? ", run complete" : `, ${outstanding - wanted} still on the floor`}${approved ? "" : " — waiting for approval"}`
  );
  if (!approved) {
    await builtGoodsWaiting({ buildNumber: build.buildNumber, productName: build.product.name, quantity: wanted, locationId: build.locationId, finishedById: user.id });
  }

  revalidatePath("/builds");
  revalidatePath("/stock");
  revalidatePath("/dispatch");
  return { success: true, finished: wanted, complete: finishesIt, approved };
}

/**
 * Approve finished units from a build into stock. Until then they are not
 * stock — nothing can dispatch, move or build with them.
 */
export async function approveBuiltGoods(entryId: string) {
  const user = await requirePermission(PERMISSIONS.BOM_BUILD_APPROVE);
  const entry = await prisma.stockEntry.findUnique({
    where: { id: entryId },
    include: { build: { select: { buildNumber: true, locationId: true } } },
  });
  if (!entry || entry.source !== "BUILT" || !entry.build) return { error: "Those built goods were not found" };
  const refusal = builtGoodsRefusal(user, entry.build);
  if (refusal) return { error: refusal };

  // Conditional, so two approvals at once cannot both go through
  const claimed = await prisma.stockEntry.updateMany({
    where: { id: entryId, status: "SUBMITTED" },
    data: { status: "APPROVED", approvedById: user.id },
  });
  if (claimed.count !== 1) return { error: "Those built goods have already been decided" };

  await logActivity("APPROVED", "StockEntry", entryId, `Approved ${entry.quantity} × ${entry.itemName} from ${entry.build.buildNumber} into stock`);
  after(() => syncBomWatches().catch((e) => console.error("Low-stock BOM sync failed:", e)));
  revalidatePath("/builds");
  revalidatePath("/stock");
  revalidatePath("/dispatch");
  revalidatePath("/dashboard");
  return { success: true };
}

/**
 * Send finished units back to the floor: they were not right. The run's
 * finished count is the sum of its entries, so removing this one returns its
 * units to "on the floor", to be finished again.
 */
export async function returnBuiltGoods(entryId: string, reason: string) {
  const user = await requirePermission(PERMISSIONS.BOM_BUILD_APPROVE);
  if (typeof reason !== "string" || !reason.trim()) return { error: "Say why they are going back" };
  const entry = await prisma.stockEntry.findUnique({
    where: { id: entryId },
    include: { build: { select: { id: true, buildNumber: true, locationId: true } } },
  });
  if (!entry || entry.source !== "BUILT" || !entry.build) return { error: "Those built goods were not found" };
  const refusal = builtGoodsRefusal(user, entry.build);
  if (refusal) return { error: refusal };
  const build = entry.build;

  const returned = await prisma.$transaction(async (tx) => {
    // Only while still waiting — approved stock is never quietly deleted
    const removed = await tx.stockEntry.deleteMany({ where: { id: entryId, status: "SUBMITTED" } });
    if (removed.count !== 1) return false;
    await tx.build.updateMany({
      where: { id: build.id, status: "COMPLETED" },
      data: { status: "IN_PROGRESS", completedAt: null },
    });
    return true;
  });
  if (!returned) return { error: "Those built goods have already been decided" };

  await logActivity(
    "REJECTED",
    "Build",
    build.id,
    `Sent ${entry.quantity} × ${entry.itemName} from ${build.buildNumber} back to the floor — ${reason.trim().slice(0, 300)}`
  );
  revalidatePath("/builds");
  revalidatePath("/dashboard");
  return { success: true };
}

/** What one unit of a run cost, from the components it consumed. */
async function unitCostOf(buildId: string): Promise<number> {
  const build = await prisma.build.findUnique({
    where: { id: buildId },
    select: {
      quantity: true,
      consumptions: { select: { quantity: true, stockEntry: { select: { unitPrice: true } } } },
    },
  });
  if (!build) return 0;
  const total = build.consumptions.reduce(
    (sum, c) => sum + c.quantity * c.stockEntry.unitPrice,
    0
  );
  return round(total / build.quantity);
}

/**
 * Ends a run that will never be finished.
 *
 * The components for the shortfall stay consumed — they are in scrap or in
 * half-built units, not back on the shelf. Pretending otherwise would put stock
 * back that nobody can find.
 */
export async function closeBuildShort(buildId: string, reason: string) {
  const user = await requirePermission(PERMISSIONS.BOM_BUILD_FINISH);

  const note = reason.trim();
  if (note.length < 3) return { error: "Say why the rest is not being made" };

  const build = await prisma.build.findUnique({
    where: { id: buildId },
    include: {
      product: { select: { code: true } },
      outputs: { select: { quantity: true } },
    },
  });
  if (!build) return { error: "That build does not exist" };
  if (build.status !== "IN_PROGRESS") return { error: "That run is not on the floor" };
  // Handled by the site the run is on
  if (resolveStockScope(user) !== "all" && build.locationId !== user.locationId) {
    return { error: "That run is at another site" };
  }

  const done = build.outputs.reduce((sum, o) => sum + o.quantity, 0);

  await prisma.build.update({
    where: { id: buildId },
    data: { status: "COMPLETED", completedAt: new Date(), closedShortReason: note },
  });

  await logActivity(
    "UPDATED",
    "Build",
    buildId,
    `Closed ${build.buildNumber} short — ${done} of ${build.quantity} ${build.product.code} made. ${note}`
  );

  revalidatePath("/builds");
  return { success: true };
}

/**
 * Puts a build back. Only possible while nothing has happened to what it
 * produced — after the goods have moved or shipped, the build is history, and
 * history does not get rewritten.
 */
export async function reverseBuild(buildId: string) {
  const user = await requirePermission(PERMISSIONS.BOM_UNBUILD);

  const build = await prisma.build.findUnique({
    where: { id: buildId },
    include: {
      product: { select: { code: true, name: true } },
      outputs: {
        select: {
          id: true,
          quantity: true,
          ...availabilityInclude,
        },
      },
    },
  });

  if (!build) return { error: "That build does not exist" };
  if (build.status === "REVERSED") return { error: "That build has already been reversed" };
  // Handled by the site the run is on
  if (resolveStockScope(user) !== "all" && build.locationId !== user.locationId) {
    return { error: "That run is at another site" };
  }

  // Every batch this run produced has to be untouched — one shipped box is
  // enough to make undoing the whole run a lie.
  const touched = build.outputs.some((o) => availableQuantity(o) !== o.quantity);
  if (touched) {
    return {
      error: `${build.product.name} from ${build.buildNumber} has already been moved or dispatched, so this build can no longer be undone.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    // Marking the build reversed is what releases the components: every
    // availability query counts consumptions of runs that are in progress or
    // completed, and this is neither.
    await tx.build.update({
      where: { id: buildId },
      data: { status: "REVERSED", reversedAt: new Date() },
    });

    if (build.outputs.length > 0) {
      await tx.stockEntry.deleteMany({
        where: { id: { in: build.outputs.map((o) => o.id) } },
      });
    }
  });

  await logActivity(
    "DELETED",
    "Build",
    buildId,
    `Reversed ${build.buildNumber} — ${build.quantity} × ${build.product.code} returned to components`
  );

  revalidatePath("/bom");
  revalidatePath("/builds");
  revalidatePath("/stock");
  revalidatePath("/dispatch");
  return { success: true };
}

/** Everything built, narrowed to what the viewer's scope allows. */
export async function getBuilds() {
  const user = await requireAnyPermission(BUILDS_PAGE_PERMISSIONS);

  const scope = resolveStockScope(user);
  const where: Prisma.BuildWhereInput = {};
  // Someone limited to their site with no site on record sees none, not all
  if (scope !== "all") where.locationId = user.locationId ?? NO_SITE;

  const builds = await prisma.build.findMany({
    where,
    include: {
      product: { select: { id: true, code: true, name: true, unit: true } },
      location: { select: { name: true } },
      builtBy: { select: { name: true } },
      bom: { select: { version: true } },
      outputs: { select: { id: true, entryNumber: true, quantity: true, status: true } },
      consumptions: {
        include: {
          stockEntry: {
            select: { entryNumber: true, itemName: true, itemCode: true, batchNumber: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return builds.map((b) => ({
    id: b.id,
    buildNumber: b.buildNumber,
    quantity: b.quantity,
    status: b.status,
    notes: b.notes,
    createdAt: b.createdAt,
    reversedAt: b.reversedAt,
    product: b.product,
    locationName: b.location.name,
    builtByName: b.builtBy.name,
    bomVersion: b.bom.version,
    // Derived, never stored — the sum of what this run has actually produced
    finished: b.outputs.reduce((sum, o) => sum + o.quantity, 0),
    onFloor:
      b.status === "IN_PROGRESS"
        ? b.quantity - b.outputs.reduce((sum, o) => sum + o.quantity, 0)
        : 0,
    outputEntryNumbers: b.outputs.map((o) => o.entryNumber),
    // What a run consumed is its recipe — only for those who may read BOMs
    seesRecipe: user.permissions.includes(PERMISSIONS.BOM_VIEW),
    // Finished but not yet stock: waiting for whoever approves built goods
    waiting: b.outputs
      .filter((o) => o.status === "SUBMITTED")
      .map((o) => ({ id: o.id, entryNumber: o.entryNumber, quantity: o.quantity })),
    // The approve action's own rule, so no button is offered that it refuses
    canApproveWaiting: builtGoodsRefusal(user, b) === null,
    closedShortReason: b.closedShortReason,
    completedAt: b.completedAt,
    consumptions: (user.permissions.includes(PERMISSIONS.BOM_VIEW) ? b.consumptions : []).map((c) => ({
      quantity: c.quantity,
      entryNumber: c.stockEntry.entryNumber,
      itemCode: c.stockEntry.itemCode,
      itemName: c.stockEntry.itemName,
      batchNumber: c.stockEntry.batchNumber,
    })),
  }));
}

/**
 * Everything with a published bill of materials, so a build can be started
 * from the Builds page rather than only from the product's own page.
 */
export async function getBuildableProducts() {
  await requirePermission(PERMISSIONS.BOM_BUILD);

  const boms = await prisma.billOfMaterials.findMany({
    where: { isActive: true, status: "PUBLISHED" },
    select: {
      version: true,
      product: {
        select: {
          id: true,
          code: true,
          name: true,
          kind: true,
          unit: true,
          category: { select: { name: true } },
        },
      },
      _count: { select: { lines: true } },
    },
    orderBy: { product: { code: "asc" } },
  });

  return boms.map((b) => ({
    id: b.product.id,
    code: b.product.code,
    name: b.product.name,
    kind: b.product.kind,
    unit: b.product.unit,
    categoryName: b.product.category.name,
    version: b.version,
    lineCount: b._count.lines,
  }));
}

/** Sites this person may build at. */
export async function getBuildLocations() {
  const user = await requirePermission(PERMISSIONS.BOM_BUILD);
  const scope = resolveStockScope(user);

  // Nobody limited to a site builds anywhere without one on record
  if (scope !== "all" && !user.locationId) return [];
  if (scope === "all") {
    return prisma.location.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  return prisma.location.findMany({
    where: { isActive: true, id: user.locationId! },
    select: { id: true, name: true },
  });
}


/**
 * Finished units waiting on this person, shaped for the dashboard's review
 * queue — the approve action's own rule decides which.
 */
export async function getReviewableBuiltGoods() {
  const user = await requirePermission(PERMISSIONS.BOM_BUILD_APPROVE);
  const scope = resolveStockScope(user);

  const waiting = await prisma.stockEntry.findMany({
    where: {
      source: "BUILT",
      status: "SUBMITTED",
      ...(scope === "all" ? {} : { build: { locationId: user.locationId ?? NO_SITE } }),
    },
    select: { id: true, quantity: true, itemName: true, build: { select: { buildNumber: true, locationId: true } } },
    orderBy: { createdAt: "asc" },
    take: 10,
  });

  return waiting
    .filter((e) => e.build && builtGoodsRefusal(user, e.build) === null)
    .map((e) => ({
      kind: "BUILT_GOODS" as const,
      id: e.id,
      title: `${e.quantity} × ${e.itemName}`,
      subtitle: `Built in ${e.build!.buildNumber} — approve into stock`,
      href: "/builds",
    }));
}
