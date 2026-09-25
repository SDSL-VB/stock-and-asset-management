/**
 * Turning "one row per receipt" into "one row per product, opening to prices".
 *
 * Used by: the Reports page only — the holdings table and its CSV export.
 * The Stock Entries page deliberately does NOT use this: there, one row IS one
 * receipt, because approving, editing and moving all act on a single receipt.
 *
 * The problem this solves: buying the same bearing twice on two dates makes two
 * StockEntry rows, so the report showed the same product twice. Combining them
 * is easy; combining them WITHOUT lying about the price is the interesting part,
 * because the two receipts may have been bought at different prices.
 *
 * The answer is two levels. The ROW is the product — 30 metres of 4C_WIRE is
 * one line saying 30, because "how much wire do we have" is the question. It
 * OPENS into one line per price: 23 at ₹234 and 7 at ₹239. Receipts bought at
 * the same price are added together inside their price, so eighteen metres and
 * five metres both at ₹234 read as 23 rather than as two lines a reader has to
 * add up.
 *
 * No averaged price is ever shown as if somebody paid it. Where a product was
 * bought at more than one price the row shows the range and the prices
 * themselves are one level down, each one real.
 *
 * This file is deliberately pure — it takes rows and returns rows, touches no
 * database and no React. That is what lets the on-screen table, the totals
 * above it and the exported CSV all read from one function and be incapable of
 * disagreeing with each other.
 */

import type { StockHoldingRow } from "@/lib/actions/reports";
import type { ProductGroup } from "@/lib/vocabulary";

/** One price this product is held at, and how much of it — a row's detail. */
export interface PriceLevel {
  unitPrice: number;
  quantity: number;
  value: number;
  /** How many receipts were added together at this price */
  entryCount: number;
  suppliers: string[];
  batches: string[];
  /** The receipts themselves, newest first */
  entries: StockHoldingRow[];
}

/** One product, with every receipt of it that is standing in this place. */
interface StockHoldingGroup {
  /** Stable identity for React keys and for expand/collapse state */
  key: string;
  productId: string | null;
  itemCode: string | null;
  itemName: string;
  categoryName: string | null;
  group: ProductGroup;
  kindLabel: string;

  /** Everything below is summed over `entries` */
  quantity: number;
  value: number;

  /** Cheapest first. One long when every receipt cost the same. */
  prices: PriceLevel[];
  /** The ends of `prices` — equal when there is only one */
  minUnitPrice: number;
  maxUnitPrice: number;

  /** Distinct values across the receipts, for the "2 receipts · 2 batches" line */
  suppliers: string[];
  batches: string[];
  locations: string[];
  entryCount: number;

  oldestReceivedAt: Date;
  latestReceivedAt: Date;

  /** The receipts themselves, newest first — what an expanded row reveals */
  entries: StockHoldingRow[];
}

/**
 * Money compared at paise precision.
 *
 * Unit prices are floats, so two receipts genuinely booked at ₹350 can be held
 * as 350 and 349.99999999999994. Comparing the raw numbers would split one row
 * into two; comparing them rounded to paise does not.
 */
function paise(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Four decimal places — the same precision heldQuantity() works to. */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Which product a receipt belongs to.
 *
 * Entries created before the product catalog existed have no `productId`, so
 * there are two fallbacks. Without them those older receipts would each become
 * their own single-row group and the consolidated view would silently look
 * broken for exactly the historical data this feature is meant to tidy up.
 *
 * The prefix keeps the three kinds of key from ever colliding — a product whose
 * id happened to equal another product's code would otherwise merge them.
 */
function groupingKeyOf(row: StockHoldingRow): string {
  if (row.productId) return `product:${row.productId}`;
  if (row.itemCode) return `code:${row.itemCode.trim().toLowerCase()}`;
  return `name:${row.itemName.trim().toLowerCase()}`;
}

/**
 * Collapse receipts into one row per product, each holding its prices.
 *
 * Returned in the same order the table wants: most valuable first, so the
 * biggest holdings are at the top without the caller sorting again.
 */
export function groupHoldings(rows: StockHoldingRow[]): StockHoldingGroup[] {
  // Insertion-ordered, so a set of rows that all cost the same still comes out
  // in a stable order after the value sort below.
  const buckets = new Map<string, StockHoldingRow[]>();

  for (const row of rows) {
    const key = groupingKeyOf(row);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      buckets.set(key, [row]);
    }
  }

  const groups: StockHoldingGroup[] = [];

  for (const [key, entries] of buckets) {
    groups.push(buildGroup(key, entries));
  }

  return groups.sort((a, b) => b.value - a.value);
}

/** One product's receipts, summed up and split by the price they were bought at. */
function buildGroup(key: string, entries: StockHoldingRow[]): StockHoldingGroup {
  // Newest receipt first, which is the order the expanded detail reads best in
  // and the order the "latest price" instinct expects.
  const sorted = [...entries].sort(
    (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
  );

  let quantity = 0;
  let value = 0;

  // price (at paise precision) → everything held at that price
  const levels = new Map<number, PriceLevel>();

  const suppliers = new Set<string>();
  const batches = new Set<string>();
  const locations = new Set<string>();

  let oldest = new Date(sorted[0].receivedAt).getTime();
  let latest = oldest;

  for (const entry of sorted) {
    quantity += entry.quantity;
    // Summed from each receipt's OWN value rather than from price × quantity
    // worked out here, so a rounded price can never move the total.
    value += entry.value;

    const price = paise(entry.unitPrice);
    const level = levels.get(price);
    if (level) {
      level.quantity += entry.quantity;
      level.value += entry.value;
      level.entryCount += 1;
      level.entries.push(entry);
      if (entry.supplierName && !level.suppliers.includes(entry.supplierName)) level.suppliers.push(entry.supplierName);
      if (entry.batchNumber && !level.batches.includes(entry.batchNumber)) level.batches.push(entry.batchNumber);
    } else {
      levels.set(price, {
        unitPrice: price,
        quantity: entry.quantity,
        value: entry.value,
        entryCount: 1,
        suppliers: entry.supplierName ? [entry.supplierName] : [],
        batches: entry.batchNumber ? [entry.batchNumber] : [],
        entries: [entry],
      });
    }

    if (entry.supplierName) suppliers.add(entry.supplierName);
    if (entry.batchNumber) batches.add(entry.batchNumber);
    if (entry.location) locations.add(entry.location);

    const received = new Date(entry.receivedAt).getTime();
    if (received < oldest) oldest = received;
    if (received > latest) latest = received;
  }

  quantity = round4(quantity);
  value = round4(value);

  const prices = [...levels.values()]
    .map((level) => ({ ...level, quantity: round4(level.quantity), value: round4(level.value) }))
    .sort((a, b) => a.unitPrice - b.unitPrice);

  // The first entry is the newest, so its name and category are the most
  // current — a product renamed after an old receipt should read by its new name.
  const newest = sorted[0];

  return {
    key,
    productId: newest.productId,
    itemCode: newest.itemCode,
    itemName: newest.itemName,
    categoryName: newest.categoryName,
    group: newest.group,
    kindLabel: newest.kindLabel,
    quantity,
    value,
    prices,
    minUnitPrice: prices[0]?.unitPrice ?? 0,
    maxUnitPrice: prices[prices.length - 1]?.unitPrice ?? 0,
    suppliers: [...suppliers],
    batches: [...batches],
    locations: [...locations],
    entryCount: sorted.length,
    oldestReceivedAt: new Date(oldest),
    latestReceivedAt: new Date(latest),
    entries: sorted,
  };
}

/**
 * Was this product bought at more than one price? The row then shows the
 * range, and the prices themselves are one level down.
 */
export function hasMixedPrices(group: StockHoldingGroup): boolean {
  return group.prices.length > 1;
}

/**
 * A one-line description of what sits behind a consolidated row —
 * "3 receipts · 2 batches · 2 vendors". Parts that say nothing are left out,
 * so a single receipt from one vendor just reads "1 receipt".
 */
export function provenanceLabel(group: StockHoldingGroup): string {
  const parts = [`${group.entryCount} receipt${group.entryCount === 1 ? "" : "s"}`];
  if (group.batches.length > 0) {
    parts.push(`${group.batches.length} batch${group.batches.length === 1 ? "" : "es"}`);
  }
  if (group.suppliers.length > 1) {
    parts.push(`${group.suppliers.length} vendors`);
  }
  return parts.join(" · ");
}
