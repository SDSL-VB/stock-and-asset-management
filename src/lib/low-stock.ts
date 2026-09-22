import { prisma } from "@/lib/prisma";
import { deliveredEntriesWhere } from "@/lib/procurement-delivery";
import {
  availableQuantity,
  committingBuildConsumptionsWhere,
  committingDispatchItemsWhere,
  centralWriteOffsWhere,
  round,
} from "@/lib/stock-availability";

/**
 * Which watched products are running low, and when to order more. The one
 * place the rule lives.
 *
 * Called by: the low-stock actions (the Procurement card, the dashboard, the
 * bell in the top bar). onTheWay() is also used by a build's readiness check.
 *
 * A product is WATCHED at a site once somebody sets a minimum for it there
 * (StockLevel). For each one:
 *
 *   daily use      what left that site's central stock in the last 90 days,
 *                  divided by the days of history there actually is
 *   lead time      days the product's vendor takes — the preferred vendor if
 *                  one is marked, otherwise the quickest (ProductVendor)
 *   reorder point  daily use × lead time + minimum
 *   LOW            when what is available has fallen to the reorder point
 *
 * Read as: "order when what is left would only just last until a new delivery
 * could arrive, and still leave the minimum on the shelf."
 *
 * What is ALREADY COMING is then taken into account, or the alert would nag:
 * after a need is raised, stock stays low until the goods land. On the way
 * means needs raised but not yet ordered, orders not yet fully delivered, and
 * deliveries booked in but still awaiting approval. A low product whose gap is
 * covered by what is coming is shown as such, and only a product still short
 * after all of it asks for action — that is what the bell counts.
 *
 * Three choices worth knowing:
 *
 * No history falls back to the minimum alone. A product nothing has been used
 * of yet has no rate to multiply, so its reorder point IS its minimum.
 *
 * Everything that left counts as use: issues to departments, consignments,
 * builds, and write-offs. A damaged bearing still has to be replaced. Only
 * CENTRAL write-offs count — a department's loss was already counted as use
 * when the stock was issued to it, and counting it again would double it.
 *
 * Nothing is stored. The alert is worked out every time it is read, so it is
 * right the moment any movement happens, and no movement can be missed because
 * somebody forgot to hook it up.
 */

/** How far back use is measured. */
const USAGE_WINDOW_DAYS = 90;

/**
 * The fewest days of history use is spread over. Without a floor, a product
 * first stocked yesterday and drawn on today would show a day's use as its
 * daily rate — one busy morning read as the normal pace.
 */
const MIN_HISTORY_DAYS = 7;

const DAY_MS = 86_400_000;

export type StockLevelRow = {
  stockLevelId: string;
  /** Watched because it is in a published BOM, with a minimum kept from it */
  fromBom: boolean;
  productId: string;
  code: string;
  name: string;
  description: string | null;
  unit: string;
  locationId: string;
  locationName: string;
  minimum: number;
  /** Free central stock at the site — `availableQuantity()`, summed */
  available: number;
  /** Per day; null when nothing has been used yet */
  dailyUse: number | null;
  vendor: { id: string; name: string } | null;
  /** Null when no vendor is recorded for the product */
  leadTimeDays: number | null;
  reorderPoint: number;
  /** Available has fallen to the reorder point */
  isLow: boolean;
  /**
   * When it last fell to its reorder point, and the movement that took it
   * there — "SE-… dispatched 5" — or null when it is not low.
   */
  lowSince: { at: Date; cause: string } | null;
  /** Needs not yet ordered + orders not yet delivered + deliveries awaiting approval */
  onTheWay: number;
  /** Low, and what is on the way does not close the gap — somebody has to act */
  needsAction: boolean;
  /** Whole days until the shelf is empty at the current pace; null without a pace */
  runsOutInDays: number | null;
  /** Whole days until it reaches its reorder point; 0 means order today */
  orderInDays: number | null;
  /**
   * How much to ask for: back up to the reorder point, plus what will be used
   * while the order is on its way, less what is already coming. Whole units;
   * zero when nothing needs doing.
   */
  suggestedQuantity: number;
};

/**
 * How much of each product is already on its way to each site: needs raised but
 * not yet ordered, orders not yet fully delivered, and deliveries booked in but
 * still awaiting approval. Returns "productId|locationId" → quantity.
 *
 * Shared by the low-stock alert and by "Request what's short" on a build, so
 * neither asks again for something the other has already asked for — pressing
 * either button twice raises nothing the second time.
 */
export async function onTheWay(
  productIds: string[],
  locationIds: string[],
): Promise<Map<string, number>> {
  if (productIds.length === 0 || locationIds.length === 0) return new Map();

  const [openNeeds, openLines, awaiting] = await Promise.all([
    // Asked for, not yet on an order (an ordered need is counted as its order line)
    prisma.purchaseIntent.findMany({
      where: {
        productId: { in: productIds },
        locationId: { in: locationIds },
        status: { in: ["PENDING", "APPROVED"] },
      },
      select: { productId: true, locationId: true, quantity: true },
    }),
    // Ordered, with whatever has already been delivered against each line
    prisma.purchaseOrderLine.findMany({
      where: {
        productId: { in: productIds },
        purchaseOrder: { status: "OPEN", locationId: { in: locationIds } },
      },
      select: {
        productId: true,
        quantity: true,
        purchaseOrder: { select: { locationId: true } },
        stockEntries: {
          where: deliveredEntriesWhere,
          select: { quantity: true },
        },
      },
    }),
    // Arrived and booked in, waiting for someone to approve it
    prisma.stockEntry.findMany({
      where: {
        productId: { in: productIds },
        locationId: { in: locationIds },
        status: "SUBMITTED",
        departmentId: null,
      },
      select: { productId: true, locationId: true, quantity: true },
    }),
  ]);

  const coming = new Map<string, number>();
  const addComing = (
    productId: string | null,
    locationId: string | null,
    qty: number,
  ) => {
    if (!productId || !locationId || qty <= 0) return;
    const key = `${productId}|${locationId}`;
    coming.set(key, (coming.get(key) ?? 0) + qty);
  };
  for (const n of openNeeds) addComing(n.productId, n.locationId, n.quantity);
  for (const l of openLines) {
    const delivered = l.stockEntries.reduce((s, e) => s + e.quantity, 0);
    addComing(l.productId, l.purchaseOrder.locationId, l.quantity - delivered);
  }
  for (const e of awaiting) addComing(e.productId, e.locationId, e.quantity);
  return coming;
}

/** One thing that changed what is available, and when. */
type Movement = { at: Date; change: number; label: string };

/**
 * When stock last fell to its reorder point, and which movement did it.
 *
 * Nothing records the moment an alert starts, so it is found by walking the
 * product's movements BACKWARDS from what is available now: undo each one in
 * turn, and the first whose undoing lifts stock back above the reorder point is
 * the movement that took it below. So "Low since 18 Sep, 14:32 — DSP-… dispatched
 * 5" is exact to the movement, and still needs nothing stored.
 *
 * Measured against today's reorder point — except before the first time any
 * was used, when there was no pace of use and the reorder point was the minimum
 * alone. Without that, the very use that raised the reorder point would look as
 * if stock had always been low. If a product has never been above it (stocked
 * below its minimum from the start), it has been low since it was first
 * stocked; if it has never been stocked at all, there is no moment to report.
 */
function whenItWentLow(
  list: Movement[],
  availableNow: number,
  reorderPoint: number,
  minimum: number,
): { at: Date; cause: string } | null {
  const newestFirst = [...list].sort((a, b) => b.at.getTime() - a.at.getTime());
  const firstUse = Math.min(...newestFirst.filter((m) => m.change < 0).map((m) => m.at.getTime()));
  // The reorder point in force at a moment: the minimum until anything was used
  const pointAt = (time: number) => (time < firstUse ? minimum : reorderPoint);
  let after = availableNow;
  for (const m of newestFirst) {
    const before = round(after - m.change);
    const t = m.at.getTime();
    if (before > pointAt(t - 1) && after <= pointAt(t)) return { at: m.at, cause: m.label };
    after = before;
  }
  const first = newestFirst[newestFirst.length - 1];
  return first ? { at: first.at, cause: "below its reorder point since it was first stocked" } : null;
}

/**
 * Every watched product at every site (or the ones given), most urgent first.
 * Five queries, most of them side by side, however many are watched.
 */
export async function stockLevelReport(
  filter: { locationIds?: string[] } = {},
): Promise<StockLevelRow[]> {
  const levels = await prisma.stockLevel.findMany({
    // A stopped watch is kept only so the BOM sync leaves it alone
    where: { stopped: false, ...(filter.locationIds ? { locationId: { in: filter.locationIds } } : {}) },
    include: {
      location: { select: { name: true } },
      product: {
        select: {
          code: true,
          name: true,
          description: true,
          unit: true,
          isActive: true,
          vendors: {
            select: {
              leadTimeDays: true,
              isPreferred: true,
              vendor: { select: { id: true, name: true, isActive: true } },
            },
          },
        },
      },
    },
  });
  // A retired product is no longer bought, so it is no longer worth an alert
  const watched = levels.filter((l) => l.product.isActive);
  if (watched.length === 0) return [];

  const since = new Date(Date.now() - USAGE_WINDOW_DAYS * DAY_MS);

  const productIds = [...new Set(watched.map((l) => l.productId))];
  const locationIds = [...new Set(watched.map((l) => l.locationId))];

  const [entries, coming] = await Promise.all([
    prisma.stockEntry.findMany({
      where: {
        productId: { in: productIds },
        locationId: { in: locationIds },
        status: "APPROVED",
        departmentId: null,
      },
      select: {
        productId: true,
        locationId: true,
        quantity: true,
        createdAt: true,
        entryNumber: true,
        // When it was approved — the moment it became available
        approvals: { where: { status: "APPROVED" }, select: { updatedAt: true } },
        // What availableQuantity() needs, plus WHEN and BY WHAT each unit left —
        // the first for daily use, both for "low since"
        issues: { select: { quantity: true, createdAt: true, issueNumber: true } },
        transferRequests: {
          where: { status: "PENDING" },
          select: { quantity: true, createdAt: true, requestNumber: true },
        },
        dispatchItems: {
          where: committingDispatchItemsWhere,
          select: { quantity: true, dispatch: { select: { createdAt: true, dispatchNumber: true } } },
        },
        buildConsumptions: {
          where: committingBuildConsumptionsWhere,
          select: { quantity: true, build: { select: { createdAt: true, buildNumber: true } } },
        },
        writeOffs: {
          where: centralWriteOffsWhere,
          select: { quantity: true, status: true, reviewedAt: true, createdAt: true, writeOffNumber: true },
        },
      },
    }),
    onTheWay(productIds, locationIds),
  ]);

  // productId|locationId → what is free, what left recently, and since when
  type Tally = { available: number; used: number; firstSeen: number };
  const tally = new Map<string, Tally>();
  const movements = new Map<string, Movement[]>();
  for (const e of entries) {
    const key = `${e.productId}|${e.locationId}`;
    const list = movements.get(key) ?? [];
    const approvedAt = e.approvals.reduce<Date | null>((latest, a) => (!latest || a.updatedAt > latest ? a.updatedAt : latest), null);
    list.push({ at: approvedAt ?? e.createdAt, change: e.quantity, label: `${e.entryNumber} arrived (+${e.quantity})` });
    for (const i of e.issues) list.push({ at: i.createdAt, change: -i.quantity, label: `${i.issueNumber} moved ${i.quantity} to a department` });
    for (const r of e.transferRequests) list.push({ at: r.createdAt, change: -r.quantity, label: `${r.requestNumber} asked for ${r.quantity}` });
    for (const d of e.dispatchItems) list.push({ at: d.dispatch.createdAt, change: -d.quantity, label: `${d.dispatch.dispatchNumber} dispatched ${d.quantity}` });
    for (const c of e.buildConsumptions) list.push({ at: c.build.createdAt, change: -c.quantity, label: `${c.build.buildNumber} used ${c.quantity}` });
    for (const w of e.writeOffs) {
      list.push(
        w.status === "APPROVED"
          ? { at: w.reviewedAt ?? w.createdAt, change: -w.quantity, label: `${w.writeOffNumber} wrote off ${w.quantity}` }
          : { at: w.createdAt, change: -w.quantity, label: `${w.writeOffNumber} reported ${w.quantity} lost or damaged` }
      );
    }
    movements.set(key, list);

    const t = tally.get(key) ?? {
      available: 0,
      used: 0,
      firstSeen: Date.now(),
    };
    t.available += availableQuantity(e);
    t.firstSeen = Math.min(t.firstSeen, e.createdAt.getTime());
    t.used +=
      e.issues
        .filter((i) => i.createdAt >= since)
        .reduce((s, i) => s + i.quantity, 0) +
      e.dispatchItems
        .filter((d) => d.dispatch.createdAt >= since)
        .reduce((s, d) => s + d.quantity, 0) +
      e.buildConsumptions
        .filter((c) => c.build.createdAt >= since)
        .reduce((s, c) => s + c.quantity, 0) +
      e.writeOffs
        .filter(
          (w) =>
            w.status === "APPROVED" && w.reviewedAt && w.reviewedAt >= since,
        )
        .reduce((s, w) => s + w.quantity, 0);
    tally.set(key, t);
  }

  const rows = watched.map((level): StockLevelRow => {
    const t = tally.get(`${level.productId}|${level.locationId}`);
    const available = round(t?.available ?? 0);

    // Spread use over the history there actually is, within the window
    const historyDays = t
      ? Math.min(
          USAGE_WINDOW_DAYS,
          Math.max(MIN_HISTORY_DAYS, (Date.now() - t.firstSeen) / DAY_MS),
        )
      : USAGE_WINDOW_DAYS;
    const dailyUse = t && t.used > 0 ? t.used / historyDays : null;

    // Preferred vendor if marked, otherwise whoever delivers fastest
    const vendors = level.product.vendors.filter((v) => v.vendor.isActive);
    const chosen =
      vendors.find((v) => v.isPreferred) ??
      [...vendors].sort((a, b) => a.leadTimeDays - b.leadTimeDays)[0] ??
      null;
    const leadTimeDays = chosen?.leadTimeDays ?? null;

    const usedDuringLead = (dailyUse ?? 0) * (leadTimeDays ?? 0);
    const reorderPoint = round(level.minimum + usedDuringLead);
    const isLow = available <= reorderPoint;
    const onTheWay = round(
      coming.get(`${level.productId}|${level.locationId}`) ?? 0,
    );
    // Short even after everything already coming has landed
    const stillShort = reorderPoint - available - onTheWay;
    const needsAction = isLow && stillShort >= 0;

    return {
      stockLevelId: level.id,
      fromBom: level.fromBom,
      productId: level.productId,
      code: level.product.code,
      name: level.product.name,
      description: level.product.description,
      unit: level.product.unit,
      locationId: level.locationId,
      locationName: level.location.name,
      minimum: level.minimum,
      available,
      dailyUse: dailyUse === null ? null : round(dailyUse),
      vendor: chosen
        ? { id: chosen.vendor.id, name: chosen.vendor.name }
        : null,
      leadTimeDays,
      reorderPoint,
      isLow,
      lowSince: isLow ? whenItWentLow(movements.get(`${level.productId}|${level.locationId}`) ?? [], available, reorderPoint, level.minimum) : null,
      onTheWay,
      needsAction,
      runsOutInDays: dailyUse ? Math.floor(available / dailyUse) : null,
      orderInDays: isLow
        ? 0
        : dailyUse
          ? Math.floor((available - reorderPoint) / dailyUse)
          : null,
      suggestedQuantity: needsAction
        ? Math.max(1, Math.ceil(stillShort + usedDuringLead))
        : 0,
    };
  });

  // Needing action first, then low-but-covered, then whatever is nearest its
  // reorder point
  return rows.sort(
    (a, b) =>
      Number(b.needsAction) - Number(a.needsAction) ||
      Number(b.isLow) - Number(a.isLow) ||
      (a.orderInDays ?? Infinity) - (b.orderInDays ?? Infinity) ||
      a.name.localeCompare(b.name),
  );
}
