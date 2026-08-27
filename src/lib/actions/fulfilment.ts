"use server";

import { prisma } from "@/lib/prisma";
import { nextReference } from "@/lib/reference-numbers";
import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS, resolveStockScope } from "@/lib/rbac/permissions";
import {
  availableQuantity,
  availabilityInclude,
  round,
} from "@/lib/stock-availability";
import {
  createSiteRequestSchema,
  reviewSiteRequestSchema,
} from "@/lib/validations/fulfilment";
import { SELF_APPROVAL_REFUSAL } from "@/lib/review-rules";
import { logActivity } from "./activity";
import { revalidatePath } from "next/cache";

/**
 * FLOW: asking another site for stock.
 *
 *   1. getFulfilmentPlan   "can we meet this order?" — what is on the shelf at
 *                          each site, what could be built there, and what is
 *                          still short. Stores nothing.
 *   2. createSiteRequest   the site that needs it asks the site that has it.
 *   3. acceptSiteRequest   the HOLDING site agrees → a real consignment is
 *                          raised, already IN_TRANSIT rather than pending,
 *                          because the destination asking for it WAS the
 *                          acceptance. Picks are oldest-first.
 *      rejectSiteRequest   or declines. Nobody may answer their own request.
 *   4. (dispatch takes over from here — see dispatch.ts)
 *
 * A withdrawn or refused consignment re-opens its request: nothing arrived, so
 * the ask still stands.
 */

/**
 * "A customer wants three simulators — can we do it, and from where?"
 *
 * Build readiness already answers that for one site. This answers it across
 * every site at once, and adds the two things that were missing: what could be
 * *made* from components already held, and what would have to *move* to make it
 * possible. Nothing here is stored — it is a question asked of current stock.
 */

export type SiteStock = {
  locationId: string;
  locationName: string;
  available: number;
  /** Complete units this site could build from components it already holds */
  buildable: number;
};

/** Uncommitted central stock of one product, per site. */
async function stockByLocation(productId: string): Promise<Map<string, number>> {
  const entries = await prisma.stockEntry.findMany({
    where: { productId, status: "APPROVED", departmentId: null },
    select: {
      locationId: true,
      quantity: true,
      ...availabilityInclude,
    },
  });

  const byLocation = new Map<string, number>();
  for (const e of entries) {
    if (!e.locationId) continue;
    const free = availableQuantity(e);
    if (free <= 0) continue;
    byLocation.set(e.locationId, round((byLocation.get(e.locationId) ?? 0) + free));
  }
  return byLocation;
}

/**
 * How many complete units of a product each site could build right now, from
 * the top level of its bill of materials.
 *
 * Deliberately one level deep, matching what building actually consumes — a
 * sub-assembly has to exist as stock before it can go into something else.
 */
async function buildableByLocation(
  productId: string,
  locationIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();

  const bom = await prisma.billOfMaterials.findFirst({
    where: { productId, isActive: true, status: "PUBLISHED" },
    include: { lines: { where: { isOptional: false } } },
  });
  if (!bom || bom.lines.length === 0) return out;

  for (const locationId of locationIds) {
    let smallest = Infinity;

    for (const line of bom.lines) {
      const stock = await stockByLocation(line.componentProductId);
      const here = stock.get(locationId) ?? 0;
      const supports =
        line.quantityPerUnit > 0 ? Math.floor(here / line.quantityPerUnit) : 0;
      smallest = Math.min(smallest, supports);
      if (smallest === 0) break;
    }

    out.set(locationId, Number.isFinite(smallest) ? smallest : 0);
  }
  return out;
}

/**
 * Whether a quantity of a product can be fulfilled, and how.
 *
 * Answers in the order someone actually thinks: what is on the shelf, where; if
 * that is not enough, what could be made; and if that is still not enough, how
 * far short we are.
 */
export async function getFulfilmentPlan(productId: string, quantity: number) {
  const user = await requirePermission(PERMISSIONS.FULFILMENT_VIEW);

  const wanted = Math.max(1, Math.floor(quantity));

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      code: true,
      name: true,
      unit: true,
      kind: true,
      billsOfMaterials: { where: { isActive: true, status: "PUBLISHED" }, select: { id: true } },
    },
  });
  if (!product) return { ok: false as const, error: "That product does not exist" };

  // Every site, for everybody holding fulfilment.view.
  //
  // This used to narrow to the viewer's own site unless they held
  // stock.scope.all, which made the feature useless for the two jobs it exists
  // for: an engineer cannot ask another site for stock without first seeing
  // that they have it, and neither can a dispatch operator.
  //
  // What is returned is a COUNT per site — how many are free there. The entries
  // behind it, with their vendor, price, batch and invoice, stay behind the
  // ordinary stock scopes. Knowing Hyderabad holds nine is what makes asking
  // possible; it says nothing about what they cost or who supplied them.
  const locations = await prisma.location.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const stock = await stockByLocation(product.id);
  const buildable = product.billsOfMaterials.length
    ? await buildableByLocation(
        product.id,
        locations.map((l) => l.id)
      )
    : new Map<string, number>();

  const sites: SiteStock[] = locations.map((l) => ({
    locationId: l.id,
    locationName: l.name,
    available: stock.get(l.id) ?? 0,
    buildable: buildable.get(l.id) ?? 0,
  }));

  const totalAvailable = round(sites.reduce((sum, s) => sum + s.available, 0));
  const totalBuildable = sites.reduce((sum, s) => sum + s.buildable, 0);
  const shortAfterStock = Math.max(0, wanted - totalAvailable);
  const shortAfterBuilding = Math.max(0, shortAfterStock - totalBuildable);

  // The site doing the asking. Stock already standing there does not have to
  // move, and a site cannot send a consignment to itself — so everything below
  // is worked out from what the OTHER sites hold.
  //
  // Null for someone with no department (Super Admin, Admin), who is asking on
  // nobody's behalf; for them every site is somewhere else.
  const viewerLocationId = user.locationId ?? null;

  const availableHere = viewerLocationId
    ? (stock.get(viewerLocationId) ?? 0)
    : 0;

  // Which OTHER sites would have to send stock, largest holding first — fewest
  // consignments for the same result. This used to include the viewer's own
  // site, which is how a Hyderabad operator was told to ask Hyderabad.
  const moves: { locationId: string; locationName: string; quantity: number }[] = [];
  let stillNeeded = round(Math.max(0, wanted - availableHere));
  for (const site of [...sites].sort((a, b) => b.available - a.available)) {
    if (stillNeeded <= 0) break;
    if (site.available <= 0) continue;
    if (site.locationId === viewerLocationId) continue;
    const take = Math.min(site.available, stillNeeded);
    moves.push({
      locationId: site.locationId,
      locationName: site.locationName,
      quantity: take,
    });
    stillNeeded = round(stillNeeded - take);
  }

  return {
    ok: true as const,
    product: {
      id: product.id,
      code: product.code,
      name: product.name,
      unit: product.unit,
      hasBom: product.billsOfMaterials.length > 0,
    },
    wanted,
    sites,
    totalAvailable,
    totalBuildable,
    shortAfterStock,
    shortAfterBuilding,
    /** True when stock alone covers it, without making or moving anything */
    coveredByStock: totalAvailable >= wanted,
    /** True once building is taken into account */
    coveredWithBuilding: totalAvailable + totalBuildable >= wanted,
    /** Which OTHER sites would have to send stock, and how much from each */
    moves,
    singleSite: sites.find((s) => s.available >= wanted)?.locationName ?? null,
    /** The site the viewer belongs to, or null for someone with no department */
    viewerLocationId,
    /** How much of the want is already standing at the viewer's own site */
    availableHere,
  };
}

/**
 * Pending requests waiting on this person, shaped for the dashboard's review
 * queue. Same rule as the Fulfilment page: your site's, or every site's if you
 * see them all.
 */
export async function getReviewableSiteRequests() {
  const user = await requirePermission(PERMISSIONS.FULFILMENT_APPROVE);

  const seesAllSites = resolveStockScope(user) === "all";
  if (!seesAllSites && !user.locationId) return [];

  const requests = await prisma.siteRequest.findMany({
    where: {
      status: "PENDING",
      ...(seesAllSites ? {} : { fromLocationId: user.locationId! }),
    },
    include: {
      product: { select: { name: true, unit: true } },
      toLocation: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return requests.map((r) => ({
    kind: "SITE_REQUEST" as const,
    id: r.id,
    title: `${r.quantity} ${r.product.unit} · ${r.product.name}`,
    subtitle: `${r.requestNumber} · for ${r.toLocation.name}`,
    href: "/fulfilment",
  }));
}

/**
 * Sites a person may raise a request *for*.
 *
 * Someone attached to a site gets an empty list, because the answer is their
 * own site and asking would be a question with one answer. Someone who sees
 * every site has no home site, so they have to say which one needs the stock.
 */
export async function getRequestDestinations() {
  const user = await requirePermission(PERMISSIONS.FULFILMENT_REQUEST);
  if (resolveStockScope(user) !== "all") return [];

  return prisma.location.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Products worth asking about — anything you make, plus anything in stock. */
export async function getFulfilmentProducts() {
  await requirePermission(PERMISSIONS.FULFILMENT_VIEW);

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: [
        { billsOfMaterials: { some: { isActive: true, status: "PUBLISHED" } } },
        { stockEntries: { some: { status: "APPROVED" } } },
      ],
    },
    select: {
      id: true,
      code: true,
      name: true,
      unit: true,
      kind: true,
      category: { select: { name: true } },
      billsOfMaterials: {
        where: { isActive: true, status: "PUBLISHED" },
        select: { id: true },
      },
    },
    orderBy: [{ category: { name: "asc" } }, { code: "asc" }],
  });

  return products.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    unit: p.unit,
    kind: p.kind,
    categoryName: p.category.name,
    hasBom: p.billsOfMaterials.length > 0,
  }));
}

/* ------------------------------------------------------------------------- */
/* Asking another site for stock                                             */
/* ------------------------------------------------------------------------- */

/**
 * Ask a site that holds stock to send some of it here.
 *
 * The asking site is the caller's own — you cannot raise a request on behalf of
 * somewhere you do not belong, unless you are one of the people who sees every
 * site, in which case the destination has to be stated.
 */
export async function createSiteRequest(data: unknown) {
  const user = await requirePermission(PERMISSIONS.FULFILMENT_REQUEST);

  const parsed = createSiteRequestSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { productId, fromLocationId, quantity, notes, toLocationId } = parsed.data;

  const seesAllSites = resolveStockScope(user) === "all";
  const destinationId = seesAllSites ? toLocationId || user.locationId : user.locationId;

  if (!destinationId) {
    return {
      error: seesAllSites
        ? "Please choose which site this is for"
        : "You are not attached to a site, so there is nowhere to send this stock.",
    };
  }
  if (destinationId === fromLocationId) {
    return { error: "That is the site you are asking from — choose a different one" };
  }

  // Only worth asking for what is actually free there. This is a courtesy
  // check, not the guarantee — acceptance re-checks, because stock moves.
  const held = (await stockByLocation(productId)).get(fromLocationId) ?? 0;
  if (held <= 0) {
    return { error: "That site is not holding any of this product" };
  }

  const [product, fromLocation, toLocation] = await Promise.all([
    prisma.product.findUnique({ where: { id: productId }, select: { name: true } }),
    prisma.location.findUnique({ where: { id: fromLocationId }, select: { name: true } }),
    prisma.location.findUnique({ where: { id: destinationId }, select: { name: true } }),
  ]);
  if (!product || !fromLocation || !toLocation) {
    return { error: "That product or site no longer exists" };
  }

  const request = await prisma.siteRequest.create({
    data: {
      requestNumber: await nextReference("SRQ"),
      productId,
      quantity,
      fromLocationId,
      toLocationId: destinationId,
      notes: notes?.trim() || null,
      requestedById: user.id,
    },
  });

  await logActivity(
    "CREATED",
    "SiteRequest",
    request.id,
    `Asked ${fromLocation.name} for ${quantity} × ${product.name} on behalf of ${toLocation.name} (${request.requestNumber})`
  );

  revalidatePath("/fulfilment");
  return { success: true, request };
}

/**
 * Requests this person can act on: what their site has been asked for, and what
 * their site has asked others for. Cross-site users see everything.
 */
export async function getSiteRequests() {
  const user = await requirePermission(PERMISSIONS.FULFILMENT_VIEW);

  const seesAllSites = resolveStockScope(user) === "all";
  const requests = await prisma.siteRequest.findMany({
    where:
      seesAllSites || !user.locationId
        ? {}
        : {
            OR: [{ fromLocationId: user.locationId }, { toLocationId: user.locationId }],
          },
    include: {
      product: { select: { code: true, name: true, unit: true } },
      fromLocation: { select: { id: true, name: true } },
      toLocation: { select: { id: true, name: true } },
      requestedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      dispatch: { select: { id: true, dispatchNumber: true, status: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  // "Incoming" is the queue with work in it — requests this person could be
  // asked to answer. Someone who sees every site can answer any of them, so
  // splitting their view into two tables would only hide the Agree button
  // behind the wrong heading.
  const mySite = user.locationId;

  return {
    incoming: seesAllSites
      ? requests
      : requests.filter((r) => mySite !== null && r.fromLocationId === mySite),
    outgoing: seesAllSites
      ? []
      : requests.filter((r) => mySite !== null && r.toLocationId === mySite),
    canApprove: user.permissions.includes(PERMISSIONS.FULFILMENT_APPROVE),
    seesAllSites,
  };
}

/**
 * Agree to a request, which raises the consignment that carries it.
 *
 * Stock is drawn oldest-first from this site's central stock, the same rotation
 * rule building uses. The dispatch is created in transit rather than pending,
 * because the destination asking for it *was* the acceptance — making them
 * accept their own request again would be a handshake with themselves.
 */
export async function acceptSiteRequest(id: string, data: unknown = {}) {
  const user = await requirePermission(PERMISSIONS.FULFILMENT_APPROVE);

  const parsed = reviewSiteRequestSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const request = await prisma.siteRequest.findUnique({
    where: { id },
    include: {
      product: { select: { name: true, unit: true } },
      fromLocation: { select: { name: true } },
      toLocation: { select: { name: true } },
    },
  });
  if (!request) return { error: "That request no longer exists" };
  if (request.status !== "PENDING") {
    return { error: `This request has already been ${request.status.toLowerCase()}` };
  }

  // Only the site being asked can answer — the whole point is that they decide
  // whether they can spare it.
  if (
    resolveStockScope(user) !== "all" &&
    request.fromLocationId !== user.locationId
  ) {
    return { error: "Only the site being asked can answer this request" };
  }
  if (request.requestedById === user.id) {
    return { error: SELF_APPROVAL_REFUSAL };
  }

  // Oldest first, so stock rotates rather than ageing at the back.
  const entries = await prisma.stockEntry.findMany({
    where: {
      productId: request.productId,
      locationId: request.fromLocationId,
      status: "APPROVED",
      departmentId: null,
    },
    select: {
      id: true,
      quantity: true,
      batchNumber: true,
      ...availabilityInclude,
    },
    orderBy: { createdAt: "asc" },
  });

  const picks: { stockEntryId: string; quantity: number; batchNumber: string | null }[] = [];
  let remaining = request.quantity;
  for (const entry of entries) {
    if (remaining <= 0) break;
    const free = Math.floor(availableQuantity(entry));
    if (free <= 0) continue;
    const take = Math.min(free, remaining);
    picks.push({ stockEntryId: entry.id, quantity: take, batchNumber: entry.batchNumber });
    remaining -= take;
  }

  if (remaining > 0) {
    const found = request.quantity - remaining;
    return {
      error: `Only ${found} of ${request.quantity} ${request.product.name} is still free here. Reject the request, or ask them to lower it.`,
    };
  }

  // The dispatch number has to be generated before the transaction, because
  // it reads the table it is about to write to.
  const dispatchNumber = await nextReference("DSP");

  const dispatch = await prisma.$transaction(async (tx) => {
    const created = await tx.dispatch.create({
      data: {
        dispatchNumber,
        originLocationId: request.fromLocationId,
        destination: "LOCATION",
        toLocationId: request.toLocationId,
        status: "IN_TRANSIT",
        notes: `Raised against site request ${request.requestNumber}`,
        createdById: user.id,
        acceptedById: user.id,
        acceptedAt: new Date(),
        items: { create: picks },
      },
    });

    await tx.siteRequest.update({
      where: { id: request.id },
      data: {
        status: "ACCEPTED",
        reviewNote: parsed.data.reviewNote?.trim() || null,
        reviewedById: user.id,
        reviewedAt: new Date(),
        dispatchId: created.id,
      },
    });

    return created;
  });

  await logActivity(
    "DISPATCHED",
    "SiteRequest",
    request.id,
    `Accepted ${request.requestNumber} — sent ${request.quantity} × ${request.product.name} from ${request.fromLocation.name} to ${request.toLocation.name} as ${dispatch.dispatchNumber}`
  );

  revalidatePath("/fulfilment");
  revalidatePath("/dispatch");
  revalidatePath("/stock");
  return { success: true, dispatchNumber: dispatch.dispatchNumber };
}

/** Decline a request. Nothing moves, and the asking site sees why. */
export async function rejectSiteRequest(id: string, data: unknown) {
  const user = await requirePermission(PERMISSIONS.FULFILMENT_APPROVE);

  const parsed = reviewSiteRequestSchema.safeParse(data);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const request = await prisma.siteRequest.findUnique({
    where: { id },
    include: { product: { select: { name: true } }, toLocation: { select: { name: true } } },
  });
  if (!request) return { error: "That request no longer exists" };
  if (request.status !== "PENDING") {
    return { error: `This request has already been ${request.status.toLowerCase()}` };
  }
  if (resolveStockScope(user) !== "all" && request.fromLocationId !== user.locationId) {
    return { error: "Only the site being asked can answer this request" };
  }
  // Withdrawing your own ask is "Cancel", not "Decline".
  if (request.requestedById === user.id) {
    return { error: SELF_APPROVAL_REFUSAL };
  }

  await prisma.siteRequest.update({
    where: { id },
    data: {
      status: "REJECTED",
      reviewNote: parsed.data.reviewNote?.trim() || null,
      reviewedById: user.id,
      reviewedAt: new Date(),
    },
  });

  await logActivity(
    "REJECTED",
    "SiteRequest",
    request.id,
    `Declined ${request.requestNumber} from ${request.toLocation.name} for ${request.quantity} × ${request.product.name}`
  );

  revalidatePath("/fulfilment");
  return { success: true };
}

/** Withdraw a request you raised, while nobody has acted on it yet. */
export async function cancelSiteRequest(id: string) {
  const user = await requirePermission(PERMISSIONS.FULFILMENT_REQUEST);

  const request = await prisma.siteRequest.findUnique({
    where: { id },
    include: { product: { select: { name: true } }, fromLocation: { select: { name: true } } },
  });
  if (!request) return { error: "That request no longer exists" };
  if (request.status !== "PENDING") {
    return { error: "Only a request nobody has answered yet can be withdrawn" };
  }

  const seesAllSites = resolveStockScope(user) === "all";
  const isMine =
    request.requestedById === user.id ||
    (user.locationId !== null && request.toLocationId === user.locationId);
  if (!seesAllSites && !isMine) {
    return { error: "Only the site that raised this request can withdraw it" };
  }

  await prisma.siteRequest.update({
    where: { id },
    data: { status: "CANCELLED", reviewedById: user.id, reviewedAt: new Date() },
  });

  await logActivity(
    "CANCELLED",
    "SiteRequest",
    request.id,
    `Withdrew ${request.requestNumber} to ${request.fromLocation.name} for ${request.quantity} × ${request.product.name}`
  );

  revalidatePath("/fulfilment");
  return { success: true };
}
