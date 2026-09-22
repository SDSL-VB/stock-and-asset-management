/**
 * What things are called, in one place.
 *
 * The catalog splits on the one question that changes every flow: do we BUY
 * this, or MAKE it? Something procured never has a bill of materials; something
 * made always does. Within procured goods there are two kinds — raw materials
 * that get used up making things, and ready goods (a TV) that are used or sold
 * exactly as bought.
 *
 * Change a label here and it changes on every page, every filter, every report
 * column and every CSV header. Nothing else should hard-code these strings.
 */

export const PRODUCT_KINDS = ["RAW", "FINISHED", "KIT"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/**
 * One of them. The database value KIT is historical — it once meant a set of
 * products shipped together — and now means ready goods: bought whole, never
 * made here. Renaming the value would rewrite every stored row for no gain, so
 * only the words changed.
 */
export const KIND_LABEL: Record<ProductKind, string> = {
  RAW: "Raw material",
  FINISHED: "Finished product",
  KIT: "Ready goods",
};

/** What each kind is, for the moment someone has to choose. */
export const KIND_HINT: Record<ProductKind, string> = {
  RAW: "Bought in and used up when something is made.",
  FINISHED: "Made here from its components, with a bill of materials, then stocked and dispatched.",
  KIT: "Bought ready to use or sell as it is — a TV, say. Never made here, so it has no bill of materials.",
};

/**
 * The two groups everything is split by: bought or made.
 *
 *   BOUGHT_IN  procured from a vendor, never a bill of materials   (RAW, KIT)
 *   MADE       assembled here from a bill of materials             (FINISHED)
 */
export const PRODUCT_GROUPS = ["BOUGHT_IN", "MADE"] as const;
export type ProductGroup = (typeof PRODUCT_GROUPS)[number];

export const GROUP_LABEL: Record<ProductGroup, string> = {
  BOUGHT_IN: "Procured",
  MADE: "Manufactured",
};

export const GROUP_LABEL_SINGULAR: Record<ProductGroup, string> = {
  BOUGHT_IN: "Item",
  MADE: "Product",
};

export const GROUP_HINT: Record<ProductGroup, string> = {
  BOUGHT_IN:
    "Bought from a vendor: raw materials that are used up making things, and ready goods used or sold as they are. Never has a bill of materials.",
  MADE: "Assembled here from its components, following a bill of materials, then stocked and dispatched.",
};

/** Which kinds belong to each group. The only place this mapping lives. */
export const GROUP_KINDS: Record<ProductGroup, ProductKind[]> = {
  BOUGHT_IN: ["RAW", "KIT"],
  MADE: ["FINISHED"],
};

export function groupOf(kind: string): ProductGroup {
  return GROUP_KINDS.MADE.includes(kind as ProductKind) ? "MADE" : "BOUGHT_IN";
}

/**
 * Whether a product of this kind is made here — and so may, and must, have a
 * bill of materials. Everything else is bought and may not have one.
 */
export function isMadeKind(kind: string): boolean {
  return groupOf(kind) === "MADE";
}

export function labelOfKind(kind: string): string {
  return KIND_LABEL[kind as ProductKind] ?? kind;
}

/** Prisma `where` fragment for one group. */
export function kindFilter(group: ProductGroup) {
  return { in: GROUP_KINDS[group] };
}

/** Colour treatment per kind, so a badge reads the same wherever it appears. */
export const KIND_BADGE: Record<ProductKind, string> = {
  RAW: "bg-slate-100 text-slate-700 border-slate-200",
  FINISHED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  KIT: "bg-violet-100 text-violet-800 border-violet-200",
};

/**
 * What a need is called at each point in its life — on the Procurement page, in
 * a need request, and in the list's CSV and PDF, which must all read the same.
 */
export const NEED_STATUS_LABEL: Record<string, string> = {
  PENDING: "Waiting",
  APPROVED: "Ready to order",
  ORDERED: "Ordered",
  REJECTED: "Declined",
  CANCELLED: "Withdrawn",
};

/** Units we suggest; anything typed is accepted, because real sheets say "Mtrs". */
export const COMMON_UNITS = [
  "pcs",
  "set",
  "Mtrs",
  "kg",
  "g",
  "L",
  "ml",
  "box",
  "roll",
  "pair",
];
