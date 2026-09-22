import { PERMISSIONS } from "@/lib/rbac/permissions";
import { notify, notifyHolders } from "./notify";

/**
 * What gets announced, to whom, in what words — every event in one place.
 *
 * Each function is called by the action that did the thing, after it has
 * succeeded. Two families:
 *
 *   waiting   (ACTION)   to the people who can act, at the place it concerns,
 *                        never to the person who raised it
 *   decided   (DECIDED)  to the person who raised it
 *
 * A delivery's lines are submitted and approved together, so the lines of one
 * delivery handled in the same minute collapse into one notification (the
 * dedupe key), not one per line.
 */

const minute = () => new Date().toISOString().slice(0, 16);

/* ---- stock entries --------------------------------------------------- */

type Entry = {
  id: string;
  entryNumber: string;
  itemName: string;
  createdById: string;
  locationId: string | null;
  departmentId: string | null;
  deliveryId: string | null;
};

const entryHref = (e: Entry) => (e.deliveryId ? `/stock/delivery/${e.deliveryId}` : `/stock/${e.id}`);

export async function entrySubmitted(e: Entry) {
  await notifyHolders(
    PERMISSIONS.STOCK_APPROVE,
    { locationId: e.locationId, departmentId: e.departmentId, exclude: [e.createdById] },
    e.deliveryId
      ? { kind: "ACTION", title: "A delivery is waiting for approval", body: "Several items booked in together", href: entryHref(e), dedupeKey: `dlv-submit:${e.deliveryId}:${minute()}` }
      : { kind: "ACTION", title: `${e.entryNumber} is waiting for approval`, body: e.itemName, href: entryHref(e) }
  );
}

export async function entryDecided(e: Entry, approved: boolean, reason?: string) {
  const what = approved ? "approved" : "sent back";
  await notify(
    [e.createdById],
    e.deliveryId
      ? { kind: "DECIDED", title: `Your delivery was ${what}`, body: reason, href: entryHref(e), dedupeKey: `dlv-${what}:${e.deliveryId}:${minute()}` }
      : { kind: "DECIDED", title: `${e.entryNumber} was ${what}`, body: reason ?? e.itemName, href: entryHref(e) }
  );
}

/* ---- needs and orders ------------------------------------------------ */

export async function needsRaised(n: { count: number; label: string; locationId: string | null; requestedById: string; requiresApproval: boolean }) {
  await notifyHolders(
    n.requiresApproval ? PERMISSIONS.PROCUREMENT_INTENT_APPROVE : PERMISSIONS.PROCUREMENT_PO_CREATE,
    { locationId: n.locationId, exclude: [n.requestedById] },
    {
      kind: "ACTION",
      title: n.requiresApproval ? `${n.label} to verify` : `${n.label} ready to order`,
      body: n.count > 1 ? `${n.count} items` : undefined,
      href: "/procurement",
    }
  );
}

export async function needDecided(n: { intentNumber: string; productName: string; requestedById: string }, outcome: "verified" | "declined" | "ordered", note?: string) {
  await notify([n.requestedById], {
    kind: "DECIDED",
    title: `${n.intentNumber} was ${outcome}`,
    body: note ? `${n.productName} — ${note}` : n.productName,
    href: "/procurement",
  });
}

/* ---- bills of materials --------------------------------------------- */

export async function bomSubmitted(b: { productId: string; productName: string; version: number; authorId: string; authorDepartmentId: string | null }) {
  await notifyHolders(
    PERMISSIONS.BOM_APPROVE,
    { departmentId: b.authorDepartmentId, exclude: [b.authorId] },
    { kind: "ACTION", title: `BOM for ${b.productName} (version ${b.version}) needs approval`, href: `/bom/${b.productId}` }
  );
}

export async function bomDecided(b: { productId: string; productName: string; version: number; authorId: string }, approved: boolean, reason?: string) {
  await notify([b.authorId], {
    kind: "DECIDED",
    title: `BOM for ${b.productName} (version ${b.version}) was ${approved ? "approved" : "sent back"}`,
    body: reason,
    href: `/bom/${b.productId}`,
  });
}

/* ---- write-offs ------------------------------------------------------ */

export async function writeOffRaised(w: { writeOffNumber: string; itemName: string; raisedById: string; locationId: string | null; departmentId: string | null }) {
  await notifyHolders(
    PERMISSIONS.STOCK_WRITEOFF_APPROVE,
    { locationId: w.locationId, departmentId: w.departmentId, exclude: [w.raisedById] },
    { kind: "ACTION", title: `${w.writeOffNumber} (loss) needs a decision`, body: w.itemName, href: "/wastage" }
  );
}

export async function writeOffDecided(w: { writeOffNumber: string; itemName: string; raisedById: string }, approved: boolean, reason?: string) {
  await notify([w.raisedById], {
    kind: "DECIDED",
    title: `${w.writeOffNumber} was ${approved ? "approved" : "declined"}`,
    body: reason ?? w.itemName,
    href: "/wastage",
  });
}

/* ---- transfers into departments -------------------------------------- */

export async function transferRequested(t: { requestNumber: string; itemName: string; requestedById: string; departmentId: string }) {
  await notifyHolders(
    PERMISSIONS.ASSETS_TRANSFER_APPROVE,
    { departmentId: t.departmentId, exclude: [t.requestedById] },
    { kind: "ACTION", title: `${t.requestNumber}: stock requested for your department`, body: t.itemName, href: "/assets" }
  );
}

export async function transferDecided(t: { requestNumber: string; itemName: string; requestedById: string }, approved: boolean, reason?: string) {
  await notify([t.requestedById], {
    kind: "DECIDED",
    title: `${t.requestNumber} was ${approved ? "approved" : "rejected"}`,
    body: reason ?? t.itemName,
    href: "/assets",
  });
}

/* ---- catalog requests ------------------------------------------------ */

export async function catalogRequested(r: { name: string; type: "PRODUCT" | "CATEGORY"; requestedById: string }) {
  await notifyHolders(
    r.type === "PRODUCT" ? PERMISSIONS.PRODUCTS_REQUEST_APPROVE : PERMISSIONS.CATEGORIES_REQUEST_APPROVE,
    { exclude: [r.requestedById] },
    { kind: "ACTION", title: `New ${r.type === "PRODUCT" ? "product" : "category"} requested: ${r.name}`, href: "/stock/products?tab=requests" }
  );
}

export async function catalogDecided(r: { name: string; requestedById: string }, approved: boolean, reason?: string) {
  await notify([r.requestedById], {
    kind: "DECIDED",
    title: `Your request for "${r.name}" was ${approved ? "approved" : "declined"}`,
    body: reason,
    href: "/stock/products?tab=requests",
  });
}

/* ---- one site asking another ----------------------------------------- */

export async function siteRequested(r: { requestNumber: string; productName: string; quantity: number; fromLocationId: string; toLocationName: string; requestedById: string }) {
  await notifyHolders(
    PERMISSIONS.FULFILMENT_APPROVE,
    { locationId: r.fromLocationId, exclude: [r.requestedById] },
    { kind: "ACTION", title: `${r.toLocationName} asks for ${r.quantity} × ${r.productName}`, body: r.requestNumber, href: "/dispatch?tab=requests" }
  );
}

export async function siteRequestDecided(r: { requestNumber: string; productName: string; requestedById: string }, accepted: boolean, detail?: string) {
  await notify([r.requestedById], {
    kind: "DECIDED",
    title: `${r.requestNumber} was ${accepted ? "accepted" : "declined"}`,
    body: detail ?? r.productName,
    href: "/dispatch?tab=requests",
  });
}
