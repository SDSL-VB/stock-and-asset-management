"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission, requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, BOM_PERMISSIONS, resolveStockScope } from "@/lib/rbac/permissions";
import {
  availableQuantity,
  availabilityInclude,
  round,
} from "@/lib/stock-availability";
import { buildSchema } from "@/lib/validations/bom";
import { logActivity } from "./activity";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";

/**
 * FLOW: making something — components out, finished product in.
 *
 *   1. createBuild        a published bill of materials plus a quantity. The
 *                         components leave central stock IMMEDIATELY, oldest
 *                         entries first, whether the work finishes today or not.
 *                         "Build now" completes at once; "Start work" leaves the
 *                         run ON THE FLOOR — counted, visible, not dispatchable.
 *   2. finishBuild        books finished units in as an ordinary approved stock
 *                         entry. Can be called repeatedly: start 10, finish 6,
 *                         and 4 stay on the floor. How many are finished is
 *                         never stored — it is the sum of the entries produced,
 *                         so the two numbers cannot drift.
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
 * Components genuinely leave central stock and the assembled product genuinely
 * arrives as an ordinary stock entry — which is why dispatch needs no special
 * case for it, and why whatever was left over still shows as itself.
 */

/** Oldest entries are drawn down first, so stock rotates instead of ageing. */
const FIFO_ORDER = { createdAt: "asc" } as const;

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

  const lines = await Promise.all(
    bom.lines.map(async (line) => {
      const entries = await entriesFor(line.componentProductId, locationId);
      const available = round(entries.reduce((sum, e) => sum + availableQuantity(e), 0));
      const needed = round(line.quantityPerUnit * wanted);

      // Value of what this line contributes, taken from the entries that would
      // actually be drawn down
      const unitCost = entries.length
        ? entries.reduce((sum, e) => sum + e.unitPrice, 0) / entries.length
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
        isOptional: line.isOptional,
        notes: line.notes,
        // How many complete units this one line could supply
        supports: line.quantityPerUnit > 0 ? Math.floor(available / line.quantityPerUnit) : 0,
        estimatedCost: canSeeValue ? round(unitCost * needed) : null,
      };
    })
  );

  // An optional line missing does not stop a build — you did not order that add-on
  const blocking = lines.filter((l) => !l.isOptional);
  const maxBuildable = blocking.length
    ? Math.max(0, Math.min(...blocking.map((l) => l.supports)))
    : 0;

  return {
    ok: true as const,
    bomId: bom.id,
    bomVersion: bom.version,
    product: bom.product,
    quantity: wanted,
    lines,
    canBuild: blocking.every((l) => l.short === 0),
    maxBuildable,
    estimatedCost: canSeeValue
      ? round(lines.reduce((sum, l) => sum + (l.estimatedCost ?? 0), 0))
      : null,
  };
}

/** Uncommitted central-stock entries of one product at one location, oldest first. */
async function entriesFor(productId: string, locationId: string) {
  return prisma.stockEntry.findMany({
    where: {
      productId,
      status: "APPROVED",
      departmentId: null,
      locationId,
    },
    select: {
      id: true,
      entryNumber: true,
      quantity: true,
      unitPrice: true,
      batchNumber: true,
      ...availabilityInclude,
    },
    orderBy: FIFO_ORDER,
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
  if (scope !== "all" && user.locationId && user.locationId !== locationId) {
    return { error: "You can only build at your own site" };
  }

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

      // Draw down each component, oldest entry first
      const consumptions: { stockEntryId: string; quantity: number }[] = [];
      let rolledUpCost = 0;

      for (const line of bom.lines) {
        let remaining = round(line.quantityPerUnit * quantity);
        if (remaining <= 0) continue;

        const entries = await entriesFor(line.componentProductId, locationId);
        const total = round(entries.reduce((sum, e) => sum + availableQuantity(e), 0));

        if (total < remaining) {
          if (line.isOptional) continue; // an add-on nobody ordered
          const product = await tx.product.findUnique({
            where: { id: line.componentProductId },
            select: { name: true, unit: true },
          });
          throw new Error(
            `SOFT:Not enough ${product?.name ?? "of one component"} — need ${remaining} ${product?.unit ?? ""}, ${total} available at ${location.name}`
          );
        }

        for (const entry of entries) {
          if (remaining <= 0) break;
          const canTake = availableQuantity(entry);
          if (canTake <= 0) continue;

          const take = round(Math.min(canTake, remaining));
          consumptions.push({ stockEntryId: entry.id, quantity: take });
          rolledUpCost += take * entry.unitPrice;
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
    product: { code: string; name: string };
    quantity: number;
    unitPrice: number;
    locationId: string;
    batchNumber: string;
    userId: string;
  }
) {
  const entryNumber = await nextEntryNumber(tx);

  return tx.stockEntry.create({
    data: {
      entryNumber,
      productId: undefined,
      itemCode: input.product.code,
      itemName: input.product.name,
      supplierName: "Built in-house",
      quantity: input.quantity,
      unitPrice: input.unitPrice,
      totalPrice: round(input.unitPrice * input.quantity),
      locationId: input.locationId,
      // Whatever was typed, else the build number — a recall follows this
      batchNumber: input.batchNumber,
      status: "APPROVED",
      departmentId: null,
      source: "BUILT",
      buildId: input.build.id,
      createdById: input.userId,
      approvedById: input.userId,
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

  await prisma.$transaction(async (tx) => {
    await createOutputEntry(tx, {
      build,
      product: build.product,
      quantity: wanted,
      unitPrice,
      locationId: build.locationId,
      batchNumber: batchNumber?.trim() || build.buildNumber,
      userId: user.id,
    });

    if (finishesIt) {
      await tx.build.update({
        where: { id: buildId },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
  });

  await logActivity(
    "UPDATED",
    "Build",
    buildId,
    `Finished ${wanted} of ${build.buildNumber} — ${build.product.code}${finishesIt ? ", run complete" : `, ${outstanding - wanted} still on the floor`}`
  );

  revalidatePath("/builds");
  revalidatePath("/stock");
  revalidatePath("/dispatch");
  return { success: true, finished: wanted, complete: finishesIt };
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
  const user = await requireAnyPermission([
    PERMISSIONS.BOM_VIEW,
    PERMISSIONS.BOM_BUILD,
  ]);

  const scope = resolveStockScope(user);
  const where: Prisma.BuildWhereInput = {};
  if (scope !== "all" && user.locationId) where.locationId = user.locationId;

  const builds = await prisma.build.findMany({
    where,
    include: {
      product: { select: { id: true, code: true, name: true, unit: true } },
      location: { select: { name: true } },
      builtBy: { select: { name: true } },
      bom: { select: { version: true } },
      outputs: { select: { id: true, entryNumber: true, quantity: true } },
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
    closedShortReason: b.closedShortReason,
    completedAt: b.completedAt,
    consumptions: b.consumptions.map((c) => ({
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

  if (scope === "all" || !user.locationId) {
    return prisma.location.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  return prisma.location.findMany({
    where: { isActive: true, id: user.locationId },
    select: { id: true, name: true },
  });
}

