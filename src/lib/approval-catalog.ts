import { PERMISSIONS, type PermissionKey } from "@/lib/rbac/permissions";

/**
 * Every approval in the system, for the Approval Flows page.
 *
 * Who decides is always a PERMISSION — change which roles hold it on the Roles
 * page. Two approvals can also be switched off entirely (`toggle`); the rest
 * are part of how stock is counted and always apply. Anyone who could approve
 * something has it approved when they raise it (except a dispatch, which the
 * receiving site always accepts).
 *
 * Purely descriptive: the rules themselves live in src/lib/review-rules.ts and
 * the actions. Keep this list in step when an approval is added.
 */

export type ApprovalSwitch = "bom" | "needs";

export type ApprovalStep = {
  /** What is being approved */
  label: string;
  /** Who decides: holders of any of these */
  permissions: PermissionKey[];
  /** Whose items a decider sees */
  reach: string;
};

export type ApprovalFlow = {
  id: string;
  title: string;
  /** Where it is decided in the app */
  where: string;
  steps: ApprovalStep[];
  toggle?: ApprovalSwitch;
};

const SITE = "Their own site, unless they see every site";

export const APPROVAL_FLOWS: ApprovalFlow[] = [
  {
    id: "stock-entry",
    title: "Stock entries",
    where: "Stock Entries",
    steps: [{ label: "Goods booked in, including call-back returns", permissions: [PERMISSIONS.STOCK_APPROVE], reach: SITE }],
  },
  {
    id: "service-entry",
    title: "Service stock entries",
    where: "Service Stock",
    steps: [{ label: "A customer's goods booked in for service", permissions: [PERMISSIONS.STOCK_SERVICE_APPROVE], reach: SITE }],
  },
  {
    id: "built-goods",
    title: "Built goods",
    where: "Builds",
    steps: [{ label: "Finished units going into stock", permissions: [PERMISSIONS.BOM_BUILD_APPROVE], reach: SITE }],
  },
  {
    id: "bom",
    title: "Bills of materials",
    where: "Bills of Materials",
    toggle: "bom",
    steps: [
      {
        label: "A new version going live (holders of Publish skip the review)",
        permissions: [PERMISSIONS.BOM_APPROVE],
        reach: "Every bill of materials",
      },
    ],
  },
  {
    id: "needs",
    title: "Needs (purchase intents)",
    where: "Procurement",
    toggle: "needs",
    steps: [{ label: "A need verified before it is ordered", permissions: [PERMISSIONS.PROCUREMENT_INTENT_APPROVE], reach: "Every need" }],
  },
  {
    id: "material-request",
    title: "Material requests",
    where: "Material Requests",
    steps: [
      { label: "1. The department agrees", permissions: [PERMISSIONS.MATERIALS_APPROVE_DEPARTMENT], reach: "Their own department" },
      { label: "2. Central stock supplies it", permissions: [PERMISSIONS.MATERIALS_SUPPLY], reach: SITE },
    ],
  },
  {
    id: "asset-transfer",
    title: "Asset and stock transfers to a department",
    where: "Assets",
    steps: [
      {
        label: "1. The receiving department agrees",
        permissions: [PERMISSIONS.ASSETS_TRANSFER_DEPARTMENT],
        reach: "Their own department",
      },
      { label: "2. Moved out of central stock", permissions: [PERMISSIONS.ASSETS_TRANSFER_APPROVE], reach: SITE },
    ],
  },
  {
    id: "write-off",
    title: "Write-offs",
    where: "Wastage",
    steps: [{ label: "Lost or damaged goods taken off the books", permissions: [PERMISSIONS.STOCK_WRITEOFF_APPROVE], reach: SITE }],
  },
  {
    id: "site-request",
    title: "Requests from another site",
    where: "Fulfilment",
    steps: [{ label: "The holding site agrees to send", permissions: [PERMISSIONS.FULFILMENT_APPROVE], reach: SITE }],
  },
  {
    id: "dispatch",
    title: "Dispatches between sites",
    where: "Dispatch",
    steps: [
      { label: "1. The receiving site accepts (never whoever raised it)", permissions: [PERMISSIONS.DISPATCH_ACCEPT], reach: SITE },
      { label: "2. Marked received on arrival", permissions: [PERMISSIONS.DISPATCH_RECEIVE], reach: SITE },
    ],
  },
  {
    id: "catalog-request",
    title: "New products and categories asked for",
    where: "Catalog",
    steps: [
      {
        label: "Added to the catalog",
        permissions: [PERMISSIONS.PRODUCTS_REQUEST_APPROVE, PERMISSIONS.CATEGORIES_REQUEST_APPROVE],
        reach: "Every request",
      },
    ],
  },
];
