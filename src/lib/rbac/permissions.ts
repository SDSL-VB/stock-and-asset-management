
/**
 * Every permission in the system, and the functions that interpret them.
 *
 * Called by: everything. Actions import `PERMISSIONS` to gate themselves, pages
 * import it to decide what to render, and `middleware.ts` names the same keys
 * as strings.
 *
 * The whole authorization model is here in three parts:
 *
 *   PERMISSIONS      one key per capability. A key is a thing you can DO, never
 *                    a job you hold — there is no "manager" permission.
 *   the groups       "any of these opens this page", so a page gate and its nav
 *                    item and its middleware route all read one list.
 *   the resolvers    scope: how MUCH you see of stock, of the activity log, of
 *                    the recycle bin. Widest held always wins.
 *
 * Adding one is five steps — see `prisma/lib/permission-catalog.ts`.
 */
export const PERMISSIONS = {
  // Users
  USERS_VIEW: "users.view",
  USERS_CREATE: "users.create",
  USERS_EDIT: "users.edit",
  USERS_DELETE: "users.delete",
  // Give one person a permission their role does not carry. Its own key, so
  // editing a phone number never implies handing out access.
  USERS_PERMISSIONS_GRANT: "users.permissions.grant",
  // Credentials are a separate facet of a profile: seeing a password and
  // changing one are independent of editing the rest of the user's details
  USERS_PASSWORD_VIEW: "users.password.view",
  USERS_PASSWORD_EDIT: "users.password.edit",

  // Roles
  ROLES_VIEW: "roles.view",
  ROLES_CREATE: "roles.create",
  ROLES_EDIT: "roles.edit",
  ROLES_DELETE: "roles.delete",

  // Departments
  DEPARTMENTS_VIEW: "departments.view",
  DEPARTMENTS_CREATE: "departments.create",
  DEPARTMENTS_EDIT: "departments.edit",
  DEPARTMENTS_DELETE: "departments.delete",

  // Clients — who we dispatch to. Viewing a client's GST number and address is
  // its own grant, deliberately withheld from department managers.
  CLIENTS_VIEW: "clients.view",
  CLIENTS_CREATE: "clients.create",
  CLIENTS_EDIT: "clients.edit",
  CLIENTS_DELETE: "clients.delete",
  // Taking the list away as a file is a different act from reading it on screen
  CLIENTS_EXPORT: "clients.export",

  // Vendors — who we buy from. Managed by admins; operators pick from the list
  // on the entry form without needing to see GST numbers and addresses.
  VENDORS_VIEW: "vendors.view",
  VENDORS_CREATE: "vendors.create",
  VENDORS_EDIT: "vendors.edit",
  VENDORS_DELETE: "vendors.delete",
  VENDORS_EXPORT: "vendors.export",

  // Activity. The log records everything; these decide who reads which part.
  // activity.view opens the page — the six below decide what is on it.
  ACTIVITY_VIEW: "activity.view",
  ACTIVITY_VIEW_STOCK: "activity.view.stock",
  ACTIVITY_VIEW_MOVEMENT: "activity.view.movement",
  ACTIVITY_VIEW_MAKING: "activity.view.making",
  ACTIVITY_VIEW_CATALOG: "activity.view.catalog",
  ACTIVITY_VIEW_PEOPLE: "activity.view.people",
  // Buying is its own history: what was asked for and what was ordered. Kept
  // apart from stock.in so someone can follow the money without reading every
  // goods receipt.
  ACTIVITY_VIEW_PROCUREMENT: "activity.view.procurement",
  // Password reveals, permission grants, deletions and configuration — kept
  // apart because reading a password is not the same kind of event as renaming
  // a department.
  ACTIVITY_VIEW_SECURITY: "activity.view.security",

  // How far the activity log reaches. The categories above decide WHAT is
  // readable; these decide WHOSE. Widest held wins, exactly like stock scope.
  ACTIVITY_SCOPE_ALL: "activity.scope.all",
  ACTIVITY_SCOPE_DEPARTMENT: "activity.scope.department",
  ACTIVITY_SCOPE_OWN: "activity.scope.own",

  // Settings
  SETTINGS_VIEW: "settings.view",
  SETTINGS_EDIT: "settings.edit",

  // Assets — stock that was moved into a department as one, not a separate
  // catalog. Seeing what a department holds and turning central stock into a
  // holding are different acts, so they are different keys.
  ASSETS_VIEW: "assets.view",
  ASSETS_CREATE: "assets.create",
  // Moving stock into a department by asking rather than doing. Asking and
  // answering are separate keys because they sit with different people: a
  // member raises it, their manager decides.
  ASSETS_TRANSFER_REQUEST: "assets.transfer.request",
  ASSETS_TRANSFER_APPROVE: "assets.transfer.approve",

  // Products (item code catalog) — each catalog action is its own permission
  PRODUCTS_VIEW: "products.view",
  // Adding something we BUY (a raw material, or ready goods like a TV) and adding
  // something we MAKE (a finished product) are different acts — only the second
  // needs a bill of materials
  // to mean anything, so it is a different grant.
  PRODUCTS_CREATE: "products.create",
  PRODUCTS_CREATE_MADE: "products.create.made",
  PRODUCTS_EDIT: "products.edit",
  // Asking for something to be added, for people who may not add it themselves.
  // The request lands on the Catalog page, where whoever can add it reviews it.
  PRODUCTS_REQUEST_CREATE: "products.request.create",
  PRODUCTS_REQUEST_APPROVE: "products.request.approve",
  CATEGORIES_CREATE: "categories.create",
  CATEGORIES_EDIT: "categories.edit",
  CATEGORIES_REQUEST_CREATE: "categories.request.create",
  CATEGORIES_REQUEST_APPROVE: "categories.request.approve",
  // Removing a record outright, as opposed to deactivating it. Separate keys so
  // a role can hide things from lists without being able to destroy history.
  PRODUCTS_DELETE: "products.delete",
  CATEGORIES_DELETE: "categories.delete",
  // Product codes are generated from the category's prefix. Changing a
  // category's prefix, or typing a code by hand instead of taking the
  // generated one, are each their own permission.
  CATEGORIES_PREFIX_EDIT: "categories.prefix.edit",
  PRODUCTS_CODE_OVERRIDE: "products.code.override",

  // Bills of materials — what a product is made of. Reading one and writing
  // one are separate: a member authors, a manager publishes, everyone consults.
  BOM_VIEW: "bom.view",
  BOM_CREATE: "bom.create",
  BOM_EDIT: "bom.edit",
  BOM_APPROVE: "bom.approve",
  // Publish without waiting for anyone — a manager's own work, or an admin fix
  BOM_PUBLISH: "bom.publish",
  BOM_DELETE: "bom.delete",
  // The verb a bill of materials would otherwise be missing: components leave
  // central stock, the assembled product arrives.
  BOM_BUILD: "bom.build",
  BOM_UNBUILD: "bom.unbuild",
  // Signing off finished work is a different act from starting it
  BOM_BUILD_FINISH: "bom.build.finish",

  // Stock Entry (Phase 3)
  STOCK_VIEW: "stock.view",
  STOCK_CREATE: "stock.create",
  STOCK_EDIT: "stock.edit",
  STOCK_APPROVE: "stock.approve",
  STOCK_MOVE: "stock.move",

  // Stock configuration — each configuration area is its own permission
  STOCK_CONFIG_FIELDS: "stock.config.fields",
  STOCK_CONFIG_ATTACHMENTS: "stock.config.attachments",
  STOCK_CONFIG_FLOWS: "stock.config.flows",
  // Who approves a bill of materials. One rule for the whole company.
  CONFIG_FLOWS_BOM: "config.flows.bom",
  // How strict the catalog is: whether a product needs a subcategory, whether a
  // subcategory needs a code, whether a product needs a description. Separate
  // from the catalog-editing keys because tightening a rule for everybody is a
  // different act from adding one product.
  CONFIG_CATALOG: "config.catalog",

  // Stock visibility scope (IAM-style): how MUCH stock a role can see.
  // The widest granted scope wins; holding none gives `own`.
  // `all` is the cross-location key — it is the only scope that reaches past the
  // user's own location, which is inherited from their department.
  STOCK_SCOPE_ALL: "stock.scope.all",
  STOCK_SCOPE_LOCATION: "stock.scope.location",
  STOCK_SCOPE_DEPARTMENT: "stock.scope.department",
  STOCK_SCOPE_OWN: "stock.scope.own",

  // Warranty and registration on a stock entry — its own facet, so a role can
  // read warranty details without being able to change them
  STOCK_WARRANTY_VIEW: "stock.warranty.view",
  STOCK_WARRANTY_EDIT: "stock.warranty.edit",

  // Setting or changing the batch a stock entry belongs to. Dispatch inherits
  // the batch, so this is the only place it is ever typed.
  STOCK_BATCH_EDIT: "stock.batch.edit",

  // Monetary visibility: prices/values are hidden without this
  STOCK_VALUE_VIEW: "stock.value.view",

  // Low stock. Being told a watched product is running out, and deciding what
  // is watched (minimums per site, vendor lead times), are separate keys: the
  // second changes an alert everybody else relies on.
  STOCK_LOWSTOCK_VIEW: "stock.lowstock.view",
  STOCK_LOWSTOCK_MANAGE: "stock.lowstock.manage",

  // Wastage — stock that stopped being stock. Raising a write-off and agreeing
  // to one are separate keys because they sit with different people: whoever
  // finds the damage reports it, their manager decides. Raising one against
  // central stock and against a department's own holding are separate again,
  // for the same reason: they are different jobs held by different people.
  STOCK_WRITEOFF_VIEW: "stock.writeoff.view",
  STOCK_WRITEOFF_CREATE: "stock.writeoff.create",
  STOCK_WRITEOFF_DEPARTMENT: "stock.writeoff.department",
  STOCK_WRITEOFF_APPROVE: "stock.writeoff.approve",
  // Undoing an approval that was itself the mistake. The record stays visible
  // as reversed rather than being deleted.
  STOCK_WRITEOFF_REVERSE: "stock.writeoff.reverse",

  // Dispatch — outgoing movement. Location-scoped: an operator sees their own
  // site's consignments both ways. None of these grant monetary visibility.
  DISPATCH_VIEW: "dispatch.view",
  DISPATCH_CREATE: "dispatch.create",
  DISPATCH_ACCEPT: "dispatch.accept",
  DISPATCH_RECEIVE: "dispatch.receive",
  DISPATCH_EXPORT: "dispatch.export",

  // The recycle bin. Being able to delete does not imply being able to see
  // what everyone else deleted, or to put it back.
  RECYCLEBIN_VIEW: "recyclebin.view",
  RECYCLEBIN_RESTORE: "recyclebin.restore",
  RECYCLEBIN_PURGE: "recyclebin.purge",
  // Whose deletions you can see. Without the wide key you get your own bin,
  // which is what makes the bin safe to give to everybody.
  RECYCLEBIN_SCOPE_ALL: "recyclebin.scope.all",
  RECYCLEBIN_SCOPE_OWN: "recyclebin.scope.own",

  // Fulfilment — can we meet an order, and from where. Asking another site for
  // stock and answering that ask are different jobs, held at different sites,
  // so they are separate keys.
  FULFILMENT_VIEW: "fulfilment.view",
  FULFILMENT_REQUEST: "fulfilment.request",
  FULFILMENT_APPROVE: "fulfilment.approve",

  // Procurement — stating a need, ordering against it, and closing it off.
  // Procurement is a job, not a department: these are keys anyone can be given,
  // so the work happens before a dedicated team exists.
  PROCUREMENT_INTENT_VIEW: "procurement.intent.view",
  PROCUREMENT_INTENT_CREATE: "procurement.intent.create",
  PROCUREMENT_INTENT_APPROVE: "procurement.intent.approve",
  PROCUREMENT_PO_VIEW: "procurement.po.view",
  PROCUREMENT_PO_CREATE: "procurement.po.create",
  PROCUREMENT_PO_CLOSE: "procurement.po.close",
  // What an order costs. Separate because a storekeeper receiving goods has no
  // business seeing the commercial terms.
  PROCUREMENT_VALUE_VIEW: "procurement.value.view",
  PROCUREMENT_CONFIG: "config.flows.procurement",

  // Reports
  REPORTS_VIEW: "reports.view",
  REPORTS_EXPORT: "reports.export",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Convenience groups for "any of these unlocks the page/feature" checks

/** Changing the catalog itself. */
export const PRODUCT_MANAGE_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.PRODUCTS_CREATE,
  PERMISSIONS.PRODUCTS_CREATE_MADE,
  PERMISSIONS.PRODUCTS_EDIT,
  PERMISSIONS.CATEGORIES_CREATE,
  PERMISSIONS.CATEGORIES_EDIT,
  PERMISSIONS.CATEGORIES_PREFIX_EDIT,
];

/**
 * Opening the Catalog page.
 *
 * Wider than managing it, because the request queue lives there too: someone
 * who can only ASK for a product still needs the page to see what happened to
 * what they asked for. Keep `middleware.ts` in step with this list.
 */
export const CATALOG_PAGE_PERMISSIONS: PermissionKey[] = [
  ...PRODUCT_MANAGE_PERMISSIONS,
  PERMISSIONS.PRODUCTS_REQUEST_CREATE,
  PERMISSIONS.PRODUCTS_REQUEST_APPROVE,
  PERMISSIONS.CATEGORIES_REQUEST_CREATE,
  PERMISSIONS.CATEGORIES_REQUEST_APPROVE,
];

/**
 * Opening the Assets page — its holdings list or its transfer queue.
 */
export const ASSET_PAGE_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.ASSETS_VIEW,
  PERMISSIONS.ASSETS_TRANSFER_REQUEST,
  PERMISSIONS.ASSETS_TRANSFER_APPROVE,
];

/**
 * Opening the Wastage page — its review queue or its history.
 *
 * Wider than stock.writeoff.view, because someone whose only job is to decide
 * on write-offs still needs the way in. Keep `middleware.ts` in step with this.
 */
export const WASTAGE_PAGE_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.STOCK_WRITEOFF_VIEW,
  PERMISSIONS.STOCK_WRITEOFF_APPROVE,
];

export const DISPATCH_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.DISPATCH_VIEW,
  PERMISSIONS.DISPATCH_CREATE,
  PERMISSIONS.DISPATCH_ACCEPT,
  PERMISSIONS.DISPATCH_RECEIVE,
  PERMISSIONS.DISPATCH_EXPORT,
];

export const BOM_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.BOM_VIEW,
  PERMISSIONS.BOM_CREATE,
  PERMISSIONS.BOM_EDIT,
  PERMISSIONS.BOM_APPROVE,
  PERMISSIONS.BOM_PUBLISH,
  PERMISSIONS.BOM_BUILD,
];

export const RECYCLE_BIN_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.RECYCLEBIN_VIEW,
  PERMISSIONS.RECYCLEBIN_RESTORE,
  PERMISSIONS.RECYCLEBIN_PURGE,
];

const PROCUREMENT_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.PROCUREMENT_INTENT_VIEW,
  PERMISSIONS.PROCUREMENT_INTENT_CREATE,
  PERMISSIONS.PROCUREMENT_INTENT_APPROVE,
  PERMISSIONS.PROCUREMENT_PO_VIEW,
  PERMISSIONS.PROCUREMENT_PO_CREATE,
  PERMISSIONS.PROCUREMENT_PO_CLOSE,
];

/**
 * Opening the Procurement page. Wider than the procurement keys because the
 * low-stock alert lives there too — running low is a reason to buy. Keep
 * `middleware.ts` in step with this.
 */
export const PROCUREMENT_PAGE_PERMISSIONS: PermissionKey[] = [
  ...PROCUREMENT_PERMISSIONS,
  PERMISSIONS.STOCK_LOWSTOCK_VIEW,
];

const FULFILMENT_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.FULFILMENT_VIEW,
  PERMISSIONS.FULFILMENT_REQUEST,
  PERMISSIONS.FULFILMENT_APPROVE,
];

/**
 * Opening the Builds page — the runs themselves, or the "Plan" tab.
 *
 * The fulfilment planner ("can we meet this order, and from where?") lives here
 * now, beside the builds it plans, so fulfilment.view opens the page too.
 * Keep `middleware.ts` in step with this.
 */
export const BUILDS_PAGE_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.BOM_VIEW,
  PERMISSIONS.BOM_BUILD,
  PERMISSIONS.BOM_UNBUILD,
  PERMISSIONS.FULFILMENT_VIEW,
];

/**
 * Opening the Dispatch page — consignments, or site requests.
 *
 * Site requests moved here from the old Fulfilment page, because accepting one
 * IS raising a consignment. The people who ask for stock (engineers, managers)
 * hold no dispatch key, so the fulfilment keys open the page as well — they see
 * only the Site requests tab, which is where they follow what they asked for.
 * Keep `middleware.ts` in step with this.
 */
export const DISPATCH_PAGE_PERMISSIONS: PermissionKey[] = [
  ...DISPATCH_PERMISSIONS,
  ...FULFILMENT_PERMISSIONS,
];

/**
 * The keys that change how the app is configured. Nothing uses this list while
 * the Configuration page is taken out; it is kept, with the keys, so the page
 * can return gated exactly as before. When it does, it needs this list in its
 * page gate, a `/configure` route in `middleware.ts` and a nav item.
 */
export const STOCK_CONFIG_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.STOCK_CONFIG_FIELDS,
  PERMISSIONS.STOCK_CONFIG_ATTACHMENTS,
  PERMISSIONS.STOCK_CONFIG_FLOWS,
  PERMISSIONS.CONFIG_FLOWS_BOM,
  PERMISSIONS.PROCUREMENT_CONFIG,
  PERMISSIONS.CONFIG_CATALOG,
];

/**
 * The three role names the code is allowed to mention by name.
 *
 * This is NOT how capabilities are decided — that is always a permission. These
 * exist only for guards where the identity of the role really is the point:
 * nobody but a Super Admin may edit the Super Admin, the two built-in roles
 * cannot be deleted, and a department manager's view of the directory stops at
 * their own department. Every one of those is about protecting a specific
 * account, not about what somebody may do.
 *
 * Adding a name here is almost always the wrong move. If you are reaching for
 * one to answer "may they?", add a permission instead.
 *
 * ("Staff" and "Stock Entry Operator" used to be listed and were referenced
 * nowhere; Staff is a retired role. They were removed rather than left as an
 * invitation to start branching on them.)
 */
export const ROLES = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  DEPARTMENT_MANAGER: "Department Manager",
} as const;

export type StockScope = "all" | "location" | "department" | "own";

/**
 * How much stock data a user may see. Widest scope held wins.
 *
 *   all        every location — the only key that reaches past the user's site
 *   location   every department plus central stock, within their own site
 *   department their own department, plus their site's central stock
 *   own        only entries they created
 *
 * Holding no scope key gives `own`, which is the safe end: a new role sees its
 * own work and nothing else until somebody widens it deliberately.
 *
 * This used to fall back to matching `user.role` against the names "Admin",
 * "Super Admin" and "Department Manager". That was the one place in the app
 * where a role's NAME decided a capability, and it was a trap: roles are
 * renamed live on the Roles page, and renaming Admin would have silently
 * dropped it from every site to its own entries. Admin now carries
 * `stock.scope.all` explicitly, which is the same answer arrived at honestly.
 *
 * Pure — safe in both server actions and client components.
 */
export function resolveStockScope(user: {
  role: string;
  permissions: string[];
}): StockScope {
  if (user.permissions.includes(PERMISSIONS.STOCK_SCOPE_ALL)) return "all";
  if (user.permissions.includes(PERMISSIONS.STOCK_SCOPE_LOCATION)) return "location";
  if (user.permissions.includes(PERMISSIONS.STOCK_SCOPE_DEPARTMENT)) return "department";
  return "own";
}

type ActivityScope = "all" | "department" | "own";

/**
 * How far someone's view of the activity log reaches. Widest held wins.
 *
 *   all         every action by everyone
 *   department  actions by their department's members, and actions done to them
 *   own         only what they did themselves
 *
 * Holding no scope key gives `own`, so a new role reads its own history and
 * nothing else until somebody widens it deliberately. This replaced a check on
 * three hard-coded role names, which meant a new role could never be trusted
 * with the log at all.
 */
export function resolveActivityScope(user: { permissions: string[] }): ActivityScope {
  if (user.permissions.includes(PERMISSIONS.ACTIVITY_SCOPE_ALL)) return "all";
  if (user.permissions.includes(PERMISSIONS.ACTIVITY_SCOPE_DEPARTMENT)) return "department";
  return "own";
}

/** Whose deletions someone can see. Own bin unless granted the wide key. */
export function resolveRecycleBinScope(user: { permissions: string[] }): "all" | "own" {
  return user.permissions.includes(PERMISSIONS.RECYCLEBIN_SCOPE_ALL) ? "all" : "own";
}
