import { PERMISSIONS, type PermissionKey } from "./permissions";

/**
 * Permissions that only work when another one is held too.
 *
 * Granting "approve a bill of materials" to someone who cannot *see* one gives
 * them a capability they can never reach — the page will not open, so the grant
 * is silently worthless. There is no way to discover that from the permission
 * list, which is why the editor now says so at the moment you tick the box.
 *
 * Each entry carries the reason, because "X requires Y" without a why is just
 * another rule to memorise.
 */

export type Dependency = {
  /** Must also be held for the key to be usable */
  requires: PermissionKey[];
  /** Plain English, shown in the prompt */
  reason: string;
};

export const PERMISSION_DEPENDENCIES: Partial<Record<PermissionKey, Dependency>> = {
  // ---- bills of materials -----------------------------------------------
  [PERMISSIONS.BOM_CREATE]: {
    requires: [PERMISSIONS.BOM_VIEW],
    reason: "Writing a bill of materials means opening one first.",
  },
  [PERMISSIONS.BOM_EDIT]: {
    requires: [PERMISSIONS.BOM_VIEW],
    reason: "Correcting a bill of materials means opening one first.",
  },
  [PERMISSIONS.BOM_APPROVE]: {
    requires: [PERMISSIONS.BOM_VIEW],
    reason: "Approving one means reading what is in it.",
  },
  [PERMISSIONS.BOM_PUBLISH]: {
    requires: [PERMISSIONS.BOM_VIEW],
    reason: "Publishing one means reading what is in it.",
  },
  [PERMISSIONS.BOM_DELETE]: {
    requires: [PERMISSIONS.BOM_VIEW],
    reason: "Deleting a version means finding it first.",
  },
  [PERMISSIONS.BOM_BUILD]: {
    requires: [PERMISSIONS.BOM_VIEW, PERMISSIONS.STOCK_VIEW],
    reason:
      "Building reads a bill of materials and draws down central stock, so it needs sight of both.",
  },
  [PERMISSIONS.BOM_BUILD_FINISH]: {
    requires: [PERMISSIONS.BOM_VIEW, PERMISSIONS.BOM_BUILD],
    reason: "Signing off a run means finding it, and only a started run can be finished.",
  },
  [PERMISSIONS.BOM_UNBUILD]: {
    requires: [PERMISSIONS.BOM_VIEW],
    reason: "Undoing a build means finding it on the Builds page.",
  },

  // ---- procurement -------------------------------------------------------
  [PERMISSIONS.PROCUREMENT_INTENT_CREATE]: {
    requires: [PERMISSIONS.PROCUREMENT_INTENT_VIEW],
    reason: "Stating a need means being able to see the ones already stated.",
  },
  [PERMISSIONS.PROCUREMENT_INTENT_APPROVE]: {
    requires: [PERMISSIONS.PROCUREMENT_INTENT_VIEW],
    reason: "Verifying a need means reading it first.",
  },
  [PERMISSIONS.PROCUREMENT_PO_CREATE]: {
    requires: [PERMISSIONS.PROCUREMENT_PO_VIEW, PERMISSIONS.PROCUREMENT_VALUE_VIEW],
    reason:
      "Placing an order means setting prices on it, so it needs sight of orders and of what they cost.",
  },
  [PERMISSIONS.PROCUREMENT_PO_CLOSE]: {
    requires: [PERMISSIONS.PROCUREMENT_PO_VIEW],
    reason: "Closing an order means finding it first.",
  },
  [PERMISSIONS.PROCUREMENT_VALUE_VIEW]: {
    requires: [PERMISSIONS.PROCUREMENT_PO_VIEW],
    reason: "Order values are shown on orders, so this does nothing without them.",
  },

  // ---- fulfilment --------------------------------------------------------
  [PERMISSIONS.FULFILMENT_REQUEST]: {
    requires: [PERMISSIONS.FULFILMENT_VIEW],
    reason:
      "You ask another site for stock from the readiness view, so you have to be able to open it.",
  },
  [PERMISSIONS.FULFILMENT_APPROVE]: {
    requires: [PERMISSIONS.FULFILMENT_VIEW, PERMISSIONS.DISPATCH_CREATE],
    reason:
      "Agreeing to a request raises a real consignment from your site, which is a dispatch.",
  },

  // ---- stock -------------------------------------------------------------
  [PERMISSIONS.STOCK_CREATE]: {
    requires: [PERMISSIONS.STOCK_VIEW],
    reason: "A new entry lands in the stock list, which has to be visible.",
  },
  [PERMISSIONS.STOCK_EDIT]: {
    requires: [PERMISSIONS.STOCK_VIEW],
    reason: "Editing an entry means opening it first.",
  },
  [PERMISSIONS.STOCK_APPROVE]: {
    requires: [PERMISSIONS.STOCK_VIEW],
    reason: "Approving an entry means reading it first.",
  },
  [PERMISSIONS.STOCK_MOVE]: {
    requires: [PERMISSIONS.STOCK_VIEW],
    reason: "Moving stock means seeing what there is to move.",
  },
  [PERMISSIONS.STOCK_VALUE_VIEW]: {
    requires: [PERMISSIONS.STOCK_VIEW],
    reason: "Prices are columns on the stock they belong to.",
  },
  [PERMISSIONS.STOCK_WARRANTY_EDIT]: {
    requires: [PERMISSIONS.STOCK_WARRANTY_VIEW],
    reason: "Recording warranty details means seeing the ones already there.",
  },
  [PERMISSIONS.STOCK_BATCH_EDIT]: {
    requires: [PERMISSIONS.STOCK_VIEW],
    reason: "A batch is typed on a stock entry.",
  },

  // Scope permissions decide *how much* stock is visible, which means nothing
  // without the permission to see stock at all.
  [PERMISSIONS.STOCK_SCOPE_ALL]: {
    requires: [PERMISSIONS.STOCK_VIEW],
    reason: "A scope widens what stock is visible; it does not grant sight of any.",
  },
  [PERMISSIONS.STOCK_SCOPE_LOCATION]: {
    requires: [PERMISSIONS.STOCK_VIEW],
    reason: "A scope widens what stock is visible; it does not grant sight of any.",
  },
  [PERMISSIONS.STOCK_SCOPE_DEPARTMENT]: {
    requires: [PERMISSIONS.STOCK_VIEW],
    reason: "A scope widens what stock is visible; it does not grant sight of any.",
  },
  [PERMISSIONS.STOCK_SCOPE_OWN]: {
    requires: [PERMISSIONS.STOCK_VIEW],
    reason: "A scope widens what stock is visible; it does not grant sight of any.",
  },

  // ---- dispatch ----------------------------------------------------------
  [PERMISSIONS.DISPATCH_CREATE]: {
    requires: [PERMISSIONS.DISPATCH_VIEW, PERMISSIONS.STOCK_VIEW],
    reason: "Raising a consignment means seeing the dispatch page and the stock going on it.",
  },
  [PERMISSIONS.DISPATCH_ACCEPT]: {
    requires: [PERMISSIONS.DISPATCH_VIEW],
    reason: "Accepting a consignment means seeing it arrive.",
  },
  [PERMISSIONS.DISPATCH_RECEIVE]: {
    requires: [PERMISSIONS.DISPATCH_VIEW],
    reason: "Confirming delivery means finding the consignment.",
  },
  [PERMISSIONS.DISPATCH_EXPORT]: {
    requires: [PERMISSIONS.DISPATCH_VIEW],
    reason: "Exporting the report means opening the page it is on.",
  },

  // ---- team --------------------------------------------------------------
  [PERMISSIONS.USERS_CREATE]: {
    requires: [PERMISSIONS.USERS_VIEW],
    reason: "A new member appears in the directory, which has to be visible.",
  },
  [PERMISSIONS.USERS_EDIT]: {
    requires: [PERMISSIONS.USERS_VIEW],
    reason: "Editing someone means opening their profile.",
  },
  [PERMISSIONS.USERS_DELETE]: {
    requires: [PERMISSIONS.USERS_VIEW],
    reason: "Removing someone means finding them first.",
  },
  [PERMISSIONS.USERS_PASSWORD_VIEW]: {
    requires: [PERMISSIONS.USERS_VIEW],
    reason: "The password card sits on a profile page.",
  },
  [PERMISSIONS.USERS_PASSWORD_EDIT]: {
    requires: [PERMISSIONS.USERS_VIEW],
    reason: "The password card sits on a profile page.",
  },
  [PERMISSIONS.USERS_PERMISSIONS_GRANT]: {
    requires: [PERMISSIONS.USERS_VIEW],
    reason: "Extra permissions are granted from someone's profile.",
  },

  // ---- catalog -----------------------------------------------------------
  [PERMISSIONS.PRODUCTS_CODE_OVERRIDE]: {
    requires: [PERMISSIONS.PRODUCTS_EDIT],
    reason: "Typing a code by hand happens while editing a product.",
  },
  [PERMISSIONS.CATEGORIES_PREFIX_EDIT]: {
    requires: [PERMISSIONS.CATEGORIES_EDIT],
    reason: "A prefix is changed on the category it belongs to.",
  },

  // ---- asking for things -------------------------------------------------
  // Each request type now lives on the page that owns the thing being asked
  // for: transfers on Assets, products and categories on the Catalog.
  [PERMISSIONS.ASSETS_TRANSFER_REQUEST]: {
    requires: [PERMISSIONS.ASSETS_VIEW, PERMISSIONS.STOCK_VIEW],
    reason:
      "You pick the stock to ask for from the Assets page, and it comes out of stock you have to be able to see.",
  },
  [PERMISSIONS.ASSETS_TRANSFER_APPROVE]: {
    requires: [PERMISSIONS.ASSETS_VIEW],
    reason: "The transfer queue is on the Assets page.",
  },
  [PERMISSIONS.PRODUCTS_REQUEST_APPROVE]: {
    requires: [PERMISSIONS.PRODUCTS_CREATE],
    reason: "Approving a product request is what creates the product.",
  },
  [PERMISSIONS.CATEGORIES_REQUEST_APPROVE]: {
    requires: [PERMISSIONS.CATEGORIES_CREATE],
    reason: "Approving a category request is what creates the category.",
  },


  // ---- activity ----------------------------------------------------------
  // A category decides what is on the page; activity.view is what opens it.
  // Granting a slice without the door is the exact dead end this map exists for.
  [PERMISSIONS.ACTIVITY_VIEW_STOCK]: {
    requires: [PERMISSIONS.ACTIVITY_VIEW],
    reason: "This decides what appears on the activity log; opening it is separate.",
  },
  [PERMISSIONS.ACTIVITY_VIEW_MOVEMENT]: {
    requires: [PERMISSIONS.ACTIVITY_VIEW],
    reason: "This decides what appears on the activity log; opening it is separate.",
  },
  [PERMISSIONS.ACTIVITY_VIEW_MAKING]: {
    requires: [PERMISSIONS.ACTIVITY_VIEW],
    reason: "This decides what appears on the activity log; opening it is separate.",
  },
  [PERMISSIONS.ACTIVITY_VIEW_CATALOG]: {
    requires: [PERMISSIONS.ACTIVITY_VIEW],
    reason: "This decides what appears on the activity log; opening it is separate.",
  },
  [PERMISSIONS.ACTIVITY_VIEW_PEOPLE]: {
    requires: [PERMISSIONS.ACTIVITY_VIEW],
    reason: "This decides what appears on the activity log; opening it is separate.",
  },
  [PERMISSIONS.ACTIVITY_VIEW_SECURITY]: {
    requires: [PERMISSIONS.ACTIVITY_VIEW],
    reason: "This decides what appears on the activity log; opening it is separate.",
  },

  // ---- assets, reports, recycle bin --------------------------------------
  [PERMISSIONS.ASSETS_CREATE]: {
    requires: [PERMISSIONS.ASSETS_VIEW, PERMISSIONS.STOCK_VIEW, PERMISSIONS.STOCK_MOVE],
    reason:
      "Making something an asset is a real stock movement out of central stock, so it needs sight of that stock and the right to move it.",
  },
  [PERMISSIONS.REPORTS_EXPORT]: {
    requires: [PERMISSIONS.REPORTS_VIEW],
    reason: "The export button is on the reports page.",
  },
  [PERMISSIONS.VENDORS_EXPORT]: {
    requires: [PERMISSIONS.VENDORS_VIEW],
    reason: "The export button is on the vendor list.",
  },
  [PERMISSIONS.CLIENTS_EXPORT]: {
    requires: [PERMISSIONS.CLIENTS_VIEW],
    reason: "The export button is on the client list.",
  },
  [PERMISSIONS.RECYCLEBIN_RESTORE]: {
    requires: [PERMISSIONS.RECYCLEBIN_VIEW],
    reason: "Restoring something means seeing it in the bin.",
  },
  [PERMISSIONS.RECYCLEBIN_PURGE]: {
    requires: [PERMISSIONS.RECYCLEBIN_VIEW],
    reason: "Emptying an entry means seeing it in the bin.",
  },
  [PERMISSIONS.RECYCLEBIN_SCOPE_ALL]: {
    requires: [PERMISSIONS.RECYCLEBIN_VIEW],
    reason: "A scope widens whose deletions are visible; it does not open the bin.",
  },
  [PERMISSIONS.RECYCLEBIN_SCOPE_OWN]: {
    requires: [PERMISSIONS.RECYCLEBIN_VIEW],
    reason: "A scope widens whose deletions are visible; it does not open the bin.",
  },

  // Activity scope decides WHOSE actions are readable, the categories decide
  // WHAT. Neither opens the page — activity.view does.
  [PERMISSIONS.ACTIVITY_VIEW_PROCUREMENT]: {
    requires: [PERMISSIONS.ACTIVITY_VIEW],
    reason: "This decides what appears on the activity log; opening it is separate.",
  },
  [PERMISSIONS.ACTIVITY_SCOPE_ALL]: {
    requires: [PERMISSIONS.ACTIVITY_VIEW],
    reason: "A scope widens whose actions are visible; it does not open the log.",
  },
  [PERMISSIONS.ACTIVITY_SCOPE_DEPARTMENT]: {
    requires: [PERMISSIONS.ACTIVITY_VIEW],
    reason: "A scope widens whose actions are visible; it does not open the log.",
  },
  [PERMISSIONS.ACTIVITY_SCOPE_OWN]: {
    requires: [PERMISSIONS.ACTIVITY_VIEW],
    reason: "A scope widens whose actions are visible; it does not open the log.",
  },
};

/**
 * The dependencies of `key` that `held` is missing.
 *
 * Walks transitively, so a permission whose dependency has its own dependency
 * reports the whole chain rather than one link of it.
 */
export function missingDependencies(key: string, held: Set<string>): PermissionKey[] {
  const out: PermissionKey[] = [];
  const seen = new Set<string>([key]);
  const queue = [key];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const dep = PERMISSION_DEPENDENCIES[current as PermissionKey];
    if (!dep) continue;

    for (const required of dep.requires) {
      if (seen.has(required)) continue;
      seen.add(required);
      queue.push(required);
      if (!held.has(required)) out.push(required);
    }
  }
  return out;
}

export function reasonFor(key: string): string | null {
  return PERMISSION_DEPENDENCIES[key as PermissionKey]?.reason ?? null;
}

/**
 * Every permission that would stop working if `key` were taken away — the
 * mirror of the above, for the moment someone unticks something.
 */
export function dependentsOf(key: string): PermissionKey[] {
  return (Object.entries(PERMISSION_DEPENDENCIES) as [PermissionKey, Dependency][])
    .filter(([, dep]) => dep.requires.includes(key as PermissionKey))
    .map(([k]) => k);
}
