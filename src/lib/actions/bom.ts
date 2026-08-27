"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission, requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, BOM_PERMISSIONS } from "@/lib/rbac/permissions";
import { bomLinesSchema, productKindSchema } from "@/lib/validations/bom";
import { wouldCreateCycle, expandBom } from "@/lib/bom-tree";
import { archive } from "@/lib/recycle-bin";
import { kindFilter } from "@/lib/vocabulary";
import { getBomFlow } from "./bom-flow";
import { logActivity } from "./activity";
import { revalidatePath } from "next/cache";

/**
 * FLOW: writing down what a product is made of.
 *
 *   1. saveBom       a member lists the components and quantities. Holding
 *                    bom.publish puts it straight into force; otherwise it is
 *                    submitted as PENDING.
 *   2. approveBom    the manager OF THE AUTHOR'S DEPARTMENT publishes it, which
 *                    retires whatever was in force before.
 *      rejectBom     or sends it back with a note saying what to fix.
 *
 * Versions are the safety net: editing the active version fixes a mistake,
 * publishing a new one records a design change, and older versions stay
 * readable so past work still explains itself.
 *
 * A bill of materials can never contain itself — see wouldCreateCycle in
 * src/lib/bom-tree.ts, which runs on save, inside the transaction.
 */

/** A product, every version of its bill of materials, and what can go into one. */
export async function getBomWorkbench(productId: string) {
  await requireAnyPermission(BOM_PERMISSIONS);

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { category: { select: { id: true, name: true, codePrefix: true } } },
  });
  if (!product) return null;

  const [versions, components] = await Promise.all([
    prisma.billOfMaterials.findMany({
      where: { productId },
      include: {
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { name: true } },
        // Who reviews this version — see bomReviewRefusal
        authorDepartment: { select: { id: true, name: true } },
        lines: {
          include: {
            component: {
              include: { category: { select: { name: true } } },
            },
          },
          orderBy: { displayOrder: "asc" },
        },
        // Status included so the UI can tell a live build from an undone one
        builds: { select: { status: true } },
        _count: { select: { lines: true, builds: true } },
      },
      orderBy: { version: "desc" },
    }),
    // Anything except the product itself can be a component; the cycle guard
    // catches the deeper cases when a line is actually saved.
    prisma.product.findMany({
      where: { isActive: true, id: { not: productId } },
      select: {
        id: true,
        code: true,
        name: true,
        unit: true,
        kind: true,
        category: { select: { name: true } },
      },
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    }),
  ]);

  return { product, versions, components };
}

/**
 * Products that could be given a bill of materials but do not have one.
 *
 * Only things you *make* — a raw material is bought in and consumed, so it is
 * what goes *into* a bill of materials, never what one is for. Something is
 * made a product on the catalog's Products tab; this lists what is waiting for
 * its recipe.
 */
export async function getBomCandidates() {
  await requireAnyPermission([PERMISSIONS.BOM_CREATE, PERMISSIONS.BOM_EDIT]);

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      kind: kindFilter("MADE"),
      billsOfMaterials: { none: {} },
    },
    select: {
      id: true,
      code: true,
      name: true,
      kind: true,
      unit: true,
      category: { select: { name: true } },
      _count: { select: { stockEntries: true } },
    },
    orderBy: [{ category: { name: "asc" } }, { code: "asc" }],
  });

  return products.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    kind: p.kind,
    unit: p.unit,
    categoryName: p.category.name,
    /** Shown so nobody promotes something they have been buying in by mistake */
    stockEntryCount: p._count.stockEntries,
  }));
}

/** The full component tree, quantities multiplied down. */
export async function getExpandedBom(productId: string, quantity = 1) {
  await requireAnyPermission(BOM_PERMISSIONS);
  return prisma.$transaction((tx) => expandBom(tx, productId, quantity));
}

export async function setProductKind(productId: string, data: unknown) {
  await requirePermission(PERMISSIONS.PRODUCTS_EDIT);

  const parsed = productKindSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const product = await prisma.product.update({
    where: { id: productId },
    data: { kind: parsed.data.kind, unit: parsed.data.unit.trim() || "pcs" },
  });

  await logActivity(
    "UPDATED",
    "Product",
    productId,
    `${product.code} is now ${parsed.data.kind.toLowerCase()}, measured in ${product.unit}`
  );

  revalidatePath("/stock/products");
  revalidatePath(`/bom/${productId}`);
  revalidatePath("/bom");
  return { success: true };
}

/**
 * Saves a bill of materials.
 *
 * Editing the version in force is a correction. Publishing a new version is how
 * a design change is recorded, so anything already built keeps pointing at the
 * version it was built to.
 *
 * Whether a new version goes live immediately or waits for a manager depends on
 * what the author holds: `bom.publish` skips the queue, `bom.create` alone
 * submits. That is the same "Create, not Request" distinction used elsewhere.
 */
export async function saveBom(
  productId: string,
  data: unknown,
  options: { asNewVersion?: boolean } = {}
) {
  const user = await requirePermission(
    options.asNewVersion ? PERMISSIONS.BOM_CREATE : PERMISSIONS.BOM_EDIT
  );
  // Two things decide whether a new version goes live immediately: the
  // company-wide rule, and whether this person is allowed to skip the queue.
  const flow = await getBomFlow();
  const canPublish = !flow.requiresApproval || user.permissions.includes(PERMISSIONS.BOM_PUBLISH);

  const parsed = bomLinesSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return { error: "Product not found" };

  // A component appearing twice would silently double the requirement
  const ids = parsed.data.lines.map((l) => l.componentProductId);
  if (new Set(ids).size !== ids.length) {
    return { error: "The same component is listed twice — combine the quantities instead" };
  }

  const result = await prisma.$transaction(async (tx) => {
    for (const line of parsed.data.lines) {
      if (await wouldCreateCycle(tx, productId, line.componentProductId)) {
        const bad = await tx.product.findUnique({
          where: { id: line.componentProductId },
          select: { name: true },
        });
        throw new Error(
          `CYCLE:${bad?.name ?? "That component"} already contains ${product.name}, directly or further down. A bill of materials cannot contain itself.`
        );
      }
    }

    // A draft or rejected version the author is still working on takes priority
    // over the published one — otherwise resubmitting would fork a new version
    // every time.
    const existing = await tx.billOfMaterials.findFirst({
      where: {
        productId,
        OR: [
          { status: { in: ["DRAFT", "REJECTED", "PENDING"] }, createdById: user.id },
          { isActive: true, status: "PUBLISHED" },
        ],
      },
      orderBy: [{ status: "asc" }, { version: "desc" }],
    });

    if (existing && !options.asNewVersion) {
      await tx.bomLine.deleteMany({ where: { bomId: existing.id } });
      await tx.billOfMaterials.update({
        where: { id: existing.id },
        data: { notes: parsed.data.notes?.trim() || null },
      });
      await tx.bomLine.createMany({
        data: parsed.data.lines.map((l, i) => ({
          bomId: existing.id,
          componentProductId: l.componentProductId,
          quantityPerUnit: l.quantityPerUnit,
          isOptional: l.isOptional ?? false,
          notes: l.notes?.trim() || null,
          displayOrder: i,
        })),
      });
      return { bom: existing, version: existing.version, created: false };
    }

    const highest = await tx.billOfMaterials.findFirst({
      where: { productId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (highest?.version ?? 0) + 1;

    // Only a published version is ever the one work is built to, and only one
    // at a time — so a version waiting for approval displaces nothing.
    if (canPublish) {
      await tx.billOfMaterials.updateMany({
        where: { productId, isActive: true },
        data: { isActive: false },
      });
    }

    const bom = await tx.billOfMaterials.create({
      data: {
        productId,
        version,
        isActive: canPublish,
        status: canPublish ? "PUBLISHED" : "PENDING",
        submittedAt: new Date(),
        approvedById: canPublish ? user.id : null,
        approvedAt: canPublish ? new Date() : null,
        notes: parsed.data.notes?.trim() || null,
        createdById: user.id,
        // Stamped from the author, never chosen. This is what sends R&D's work
        // to R&D's manager and Production's to Production's — a product itself
        // belongs to no department, so there is nothing else to route by.
        authorDepartmentId: user.departmentId ?? null,
        lines: {
          create: parsed.data.lines.map((l, i) => ({
            componentProductId: l.componentProductId,
            quantityPerUnit: l.quantityPerUnit,
            isOptional: l.isOptional ?? false,
            notes: l.notes?.trim() || null,
            displayOrder: i,
          })),
        },
      },
    });

    return { bom, version, created: true, published: canPublish };
  }).catch((e: Error) => {
    if (e.message.startsWith("CYCLE:")) return { cycle: e.message.slice(6) };
    throw e;
  });

  if ("cycle" in result) return { error: result.cycle };

  const what = result.created
    ? result.published
      ? `Published version ${result.version}`
      : `Submitted version ${result.version} for approval`
    : `Updated version ${result.version}`;

  await logActivity(
    result.created ? "CREATED" : "UPDATED",
    "BillOfMaterials",
    result.bom.id,
    `${what} of the bill of materials for ${product.code} — ${parsed.data.lines.length} component${parsed.data.lines.length === 1 ? "" : "s"}`
  );

  revalidatePath(`/bom/${productId}`);
  revalidatePath("/bom");
  return {
    success: true,
    version: result.version,
    created: result.created,
    published: result.published,
  };
}

/**
 * Why this person may not review this submission, or null if they may.
 *
 * A manager signs off their OWN department's work. The submission carries the
 * department its author belonged to, because the product it describes belongs
 * to nobody — without that, any holder of bom.approve could publish anyone's
 * design.
 *
 * Two deliberate exemptions: a submission with no department (written by an
 * admin) is reviewable by anyone holding the key, and so is anything, for
 * someone who can publish without approval in the first place.
 */
function bomReviewRefusal(
  bom: { authorDepartmentId: string | null },
  user: { departmentId?: string | null; permissions: string[] }
): string | null {
  if (user.permissions.includes(PERMISSIONS.BOM_PUBLISH) && !user.departmentId) return null;
  if (bom.authorDepartmentId === null) return null;
  if (bom.authorDepartmentId === user.departmentId) return null;
  return "That was written by another department, so their manager reviews it";
}

/**
 * A manager approves a submitted bill of materials, which publishes it and
 * retires whatever was in force. Approving your own work is refused — someone
 * who should not have to wait holds `bom.publish` and never lands here.
 */
export async function approveBom(bomId: string) {
  const user = await requirePermission(PERMISSIONS.BOM_APPROVE);

  const bom = await prisma.billOfMaterials.findUnique({
    where: { id: bomId },
    include: { product: { select: { id: true, code: true } } },
  });
  if (!bom) return { error: "That version does not exist" };
  if (bom.status !== "PENDING") return { error: "That version is not waiting for approval" };
  if (bom.createdById === user.id && !user.permissions.includes(PERMISSIONS.BOM_PUBLISH)) {
    return { error: "You cannot approve a bill of materials you wrote yourself" };
  }

  const wrongDepartment = bomReviewRefusal(bom, user);
  if (wrongDepartment) return { error: wrongDepartment };

  await prisma.$transaction([
    prisma.billOfMaterials.updateMany({
      where: { productId: bom.productId, isActive: true },
      data: { isActive: false },
    }),
    prisma.billOfMaterials.update({
      where: { id: bomId },
      data: {
        status: "PUBLISHED",
        isActive: true,
        approvedById: user.id,
        approvedAt: new Date(),
        rejectionReason: null,
      },
    }),
  ]);

  await logActivity(
    "APPROVED",
    "BillOfMaterials",
    bomId,
    `Approved version ${bom.version} of the bill of materials for ${bom.product.code} — it is now the version in force`
  );

  revalidatePath(`/bom/${bom.productId}`);
  revalidatePath("/bom");
  return { success: true };
}

/** Sends a submitted version back to its author with a note. */
export async function rejectBom(bomId: string, reason: string) {
  const user = await requirePermission(PERMISSIONS.BOM_APPROVE);

  const note = reason.trim();
  if (note.length < 3) return { error: "Say what needs fixing" };

  const bom = await prisma.billOfMaterials.findUnique({
    where: { id: bomId },
    include: { product: { select: { id: true, code: true } } },
  });
  if (!bom) return { error: "That version does not exist" };
  if (bom.status !== "PENDING") return { error: "That version is not waiting for approval" };

  const wrongDepartment = bomReviewRefusal(bom, user);
  if (wrongDepartment) return { error: wrongDepartment };

  await prisma.billOfMaterials.update({
    where: { id: bomId },
    data: { status: "REJECTED", rejectionReason: note, isActive: false },
  });

  await logActivity(
    "REJECTED",
    "BillOfMaterials",
    bomId,
    `Sent version ${bom.version} of the bill of materials for ${bom.product.code} back to its author: ${note}`
  );

  revalidatePath(`/bom/${bom.productId}`);
  revalidatePath("/bom");
  return { success: true };
}

/**
 * Removes a version outright. Refused for anything a build was made to, because
 * that build would then be unable to explain what it consumed.
 */
export async function deleteBom(bomId: string, options: { force?: boolean } = {}) {
  const user = await requirePermission(PERMISSIONS.BOM_DELETE);

  const bom = await prisma.billOfMaterials.findUnique({
    where: { id: bomId },
    include: {
      product: { select: { id: true, code: true, name: true } },
      // Split by status: a build that was undone produced nothing and consumed
      // nothing, so it has no claim on this version. Only live builds block.
      builds: { select: { id: true, status: true } },
      _count: { select: { lines: true } },
    },
  });
  if (!bom) return { error: "That version does not exist" };

  const liveBuilds = bom.builds.filter((b) => b.status === "COMPLETED");
  const reversedBuilds = bom.builds.filter((b) => b.status === "REVERSED");

  if (liveBuilds.length > 0) {
    return {
      blocked: true,
      error: `Version ${bom.version} was used to build ${liveBuilds.length} time${liveBuilds.length === 1 ? "" : "s"}. Deleting it would leave those builds unable to say what they consumed — retire it by publishing a new version instead.`,
    };
  }

  // The nudge: unless they have already insisted, offer the reversible option
  if (!options.force && bom.isActive) {
    return {
      needsConfirmation: true,
      title: `Delete version ${bom.version}?`,
      message: `This is the version currently in force for ${bom.product.code} ${bom.product.name}, with ${bom._count.lines} component${bom._count.lines === 1 ? "" : "s"}. Deleting it leaves the product with no bill of materials and cannot be undone.`,
      recommendation:
        "Publish a corrected version instead — the old one is retired automatically and stays readable.",
      confirmLabel: "Delete permanently",
    };
  }

  // Reversed builds hold a foreign key to this version, so the row cannot go
  // while they exist. They are cancelled records that changed no stock, so they
  // go with it rather than standing in the way.
  const removedReversedBuilds = reversedBuilds.length;

  await prisma.$transaction(async (tx) => {
    // The lines go with it, so they ride along in the snapshot rather than
    // being archived separately — a bill of materials without its components
    // is not something anyone would want back.
    const lines = await tx.bomLine.findMany({ where: { bomId } });
    const { _count, product, builds: _builds, ...row } = bom;

    await archive(tx, {
      entity: "BillOfMaterials",
      entityId: bomId,
      label: `${product.code} ${product.name} — version ${bom.version}`,
      snapshot: {
        ...row,
        lines: {
          create: lines.map((l) => ({
            componentProductId: l.componentProductId,
            quantityPerUnit: l.quantityPerUnit,
            isOptional: l.isOptional,
            notes: l.notes,
            displayOrder: l.displayOrder,
          })),
        },
      },
      deletedById: user.id,
    });

    if (removedReversedBuilds > 0) {
      await tx.build.deleteMany({ where: { bomId, status: "REVERSED" } });
    }

    await tx.billOfMaterials.delete({ where: { id: bomId } });
  });

  await logActivity(
    "DELETED",
    "BillOfMaterials",
    bomId,
    `Deleted version ${bom.version} of the bill of materials for ${bom.product.code}` +
      (removedReversedBuilds > 0
        ? `, along with ${removedReversedBuilds} undone build${removedReversedBuilds === 1 ? "" : "s"}`
        : "")
  );

  revalidatePath(`/bom/${bom.productId}`);
  revalidatePath("/bom");
  return { success: true };
}

/** Makes an older published version the one work is built to again. */
export async function activateBomVersion(bomId: string) {
  await requirePermission(PERMISSIONS.BOM_EDIT);

  const bom = await prisma.billOfMaterials.findUnique({
    where: { id: bomId },
    include: { product: { select: { id: true, code: true } } },
  });
  if (!bom) return { error: "That version does not exist" };
  if (bom.status !== "PUBLISHED") {
    return { error: "Only an approved version can be put back in force" };
  }

  await prisma.$transaction([
    prisma.billOfMaterials.updateMany({
      where: { productId: bom.productId, isActive: true },
      data: { isActive: false },
    }),
    prisma.billOfMaterials.update({ where: { id: bomId }, data: { isActive: true } }),
  ]);

  await logActivity(
    "UPDATED",
    "BillOfMaterials",
    bomId,
    `Version ${bom.version} is now the active bill of materials for ${bom.product.code}`
  );

  revalidatePath(`/bom/${bom.productId}`);
  return { success: true };
}

/**
 * Every product, with the state of its bill of materials. Grouped by category on the page
 * because that is how the physical sheets are organised.
 */
export async function getBomCatalog() {
  await requireAnyPermission(BOM_PERMISSIONS);

  const [products, boms, usage] = await Promise.all([
    prisma.product.findMany({
      // Only things you *make* own a bill of materials. A raw material is
      // bought in through a stock entry and used up — listing every one of them
      // here buried the handful of products that actually have a recipe. Raw
      // materials still appear in the component picker, which is the point of
      // them.
      //
      // Anything that already has one stays listed whatever its kind, so a bill
      // of materials can never become unreachable — including to delete it.
      where: {
        isActive: true,
        OR: [{ kind: kindFilter("MADE") }, { billsOfMaterials: { some: {} } }],
      },
      select: {
        id: true,
        code: true,
        name: true,
        kind: true,
        unit: true,
        category: { select: { id: true, name: true, codePrefix: true } },
      },
      orderBy: [{ category: { name: "asc" } }, { code: "asc" }],
    }),
    prisma.billOfMaterials.findMany({
      where: { status: { in: ["PUBLISHED", "PENDING"] } },
      select: {
        productId: true,
        version: true,
        status: true,
        isActive: true,
        updatedAt: true,
        _count: { select: { lines: true } },
      },
      orderBy: { version: "desc" },
    }),
    // How many live bills of materials call for this product — the "what breaks if I
    // change this" number
    prisma.bomLine.groupBy({
      by: ["componentProductId"],
      where: { bom: { isActive: true } },
      _count: { _all: true },
    }),
  ]);

  // The version in force, and separately whether anything is waiting on a manager
  const liveByProduct = new Map(
    boms.filter((b) => b.isActive && b.status === "PUBLISHED").map((b) => [b.productId, b])
  );
  const pendingByProduct = new Map(
    boms.filter((b) => b.status === "PENDING").map((b) => [b.productId, b])
  );
  const usedIn = new Map(usage.map((u) => [u.componentProductId, u._count._all]));

  return products.map((p) => {
    const bom = liveByProduct.get(p.id);
    const pending = pendingByProduct.get(p.id);
    return {
      ...p,
      bom: bom
        ? { version: bom.version, lineCount: bom._count.lines, updatedAt: bom.updatedAt }
        : null,
      pendingVersion: pending?.version ?? null,
      // How many live bills of materials call for it — what breaks if it changes
      usedInCount: usedIn.get(p.id) ?? 0,
    };
  });
}
