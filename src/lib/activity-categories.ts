import { PERMISSIONS } from "@/lib/rbac/permissions";

/**
 * What the activity log records, grouped into things a person might be trusted
 * with separately.
 *
 * Reading the log is two questions, answered by two sets of keys. These decide
 * WHAT is readable — one permission per category below. `activity.scope.*`
 * decides WHOSE actions, which is a separate matter.
 *
 * Nothing stops being recorded. This only decides who can read which part.
 */

export const ACTIVITY_CATEGORIES = {
  stock: {
    label: "Stock in",
    hint: "Goods arriving: entries, their documents and their approvals",
    entities: ["StockEntry", "StockEntryAttachment", "StockApproval"],
    permission: PERMISSIONS.ACTIVITY_VIEW_STOCK,
  },
  dispatch: {
    label: "Dispatch",
    hint: "Goods arriving: entries, their documents and their approvals",
    entities: ["Dispatch", "Client"],
    permission: PERMISSIONS.ACTIVITY_VIEW_MOVEMENT,
  },
  procurement: {
    label: "Buying",
    hint: "What was asked for, what was ordered, and what is watched for running low",
    entities: ["PurchaseIntent", "PurchaseOrder", "NeedList", "StockLevel", "ProductVendor"],
    permission: PERMISSIONS.ACTIVITY_VIEW_PROCUREMENT,
  },
  movement: {
    label: "Stock out",
    hint: "Issues to departments, transfers, dispatches, site requests and write-offs",
    entities: [
      "StockIssue",
      "StockTransferRequest",
      "Dispatch",
      "SiteRequest",
      // Stock leaving because it was damaged or lost is still stock leaving.
      "StockWriteOff",
    ],
    permission: PERMISSIONS.ACTIVITY_VIEW_MOVEMENT,
  },
  production: {
    label: "Production",
    hint: "Bills of materials and builds",
    entities: ["BillOfMaterials", "Build"],
    permission: PERMISSIONS.ACTIVITY_VIEW_MAKING,
  },
  catalog: {
    label: "Catalog",
    hint: "Products, categories, vendors and clients",
    entities: ["Product", "ProductCategory", "ProductSubcategory", "ProductRequest", "Vendor", "Client"],
    permission: PERMISSIONS.ACTIVITY_VIEW_CATALOG,
  },
  people: {
    label: "People",
    hint: "Team members, roles, departments and sites",
    entities: ["User", "Role", "Department", "Location"],
    permission: PERMISSIONS.ACTIVITY_VIEW_PEOPLE,
  },
  security: {
    label: "Security & settings",
    hint: "Password reveals, permission grants, deletions and configuration",
    entities: [
      "UserPermission",
      "DeletedRecord",
      "ApprovalFlowConfig",
      "ApprovalFlowStep",
      "AttachmentTypeConfig",
      // Configuration changes. Nothing writes these while the Configuration
      // page is taken out, but past log lines carry them and still belong here.
      // (Field changes were logged as "StockFieldConfig", not the model name.)
      "StockFieldConfig",
      "BomFlowConfig",
      "ProcurementFlowConfig",
      "CatalogConfig",
    ],
    permission: PERMISSIONS.ACTIVITY_VIEW_SECURITY,
  },
} as const;

export type ActivityCategory = keyof typeof ACTIVITY_CATEGORIES;

export const ACTIVITY_CATEGORY_KEYS = Object.keys(ACTIVITY_CATEGORIES) as ActivityCategory[];

/**
 * Actions that belong to Security whatever they were done to.
 *
 * Reading someone's password is a security event even though it is recorded
 * against a User, and grouping it with "renamed a department" would put the
 * most sensitive line in the log behind the least sensitive permission.
 */
export const SECURITY_ACTIONS = [
  "PASSWORD_VIEWED",
  "PASSWORD_RESET",
  // Somebody changing their own password. Recorded against a User but it
  // belongs here, the same as the two above.
  "PASSWORD_CHANGED",
];

/** The categories a set of permissions may read. */
export function readableCategories(held: string[]): ActivityCategory[] {
  return ACTIVITY_CATEGORY_KEYS.filter((key) =>
    held.includes(ACTIVITY_CATEGORIES[key].permission)
  );
}

