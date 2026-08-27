/**
 * What things are called, in one place.
 *
 * The catalog used to be one flat list of "products" doing two jobs at once:
 * the cable you buy by the metre and the machine you assemble from it. Those
 * are different kinds of thing with different flows, so the app now says which
 * is which — and says it with these words.
 *
 * Change a label here and it changes on every page, every filter, every report
 * column and every CSV header. Nothing else should hard-code these strings.
 */

export const PRODUCT_KINDS = ["RAW", "FINISHED", "KIT"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/** One of them. */
export const KIND_LABEL: Record<ProductKind, string> = {
  RAW: "Raw material",
  FINISHED: "Finished product",
  KIT: "Complete product",
};

/** What each kind is, for the moment someone has to choose. */
export const KIND_HINT: Record<ProductKind, string> = {
  RAW: "Bought in and used up when something is made.",
  FINISHED: "Made here from its components, then stocked and dispatched.",
  KIT: "A set of products that ship together, built up and stocked as one.",
};

/**
 * The two groups everything is split by.
 *
 *   BOUGHT_IN  things we purchase and consume        (RAW)
 *   MADE       things we assemble and sell           (FINISHED, KIT)
 */
export const PRODUCT_GROUPS = ["BOUGHT_IN", "MADE"] as const;
export type ProductGroup = (typeof PRODUCT_GROUPS)[number];

export const GROUP_LABEL: Record<ProductGroup, string> = {
  BOUGHT_IN: "Raw materials",
  MADE: "Products",
};

export const GROUP_LABEL_SINGULAR: Record<ProductGroup, string> = {
  BOUGHT_IN: "Raw material",
  MADE: "Product",
};

export const GROUP_HINT: Record<ProductGroup, string> = {
  BOUGHT_IN: "Bought from a vendor and consumed. What goes into the things you make.",
  MADE: "Assembled here from raw materials, then stocked and dispatched.",
};

/** Which kinds belong to each group. The only place this mapping lives. */
export const GROUP_KINDS: Record<ProductGroup, ProductKind[]> = {
  BOUGHT_IN: ["RAW"],
  MADE: ["FINISHED", "KIT"],
};

export function groupOf(kind: string): ProductGroup {
  return GROUP_KINDS.MADE.includes(kind as ProductKind) ? "MADE" : "BOUGHT_IN";
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
