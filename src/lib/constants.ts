import {
  LayoutDashboard,
  Users,
  Shield,
  Building2,
  Activity,
  Package,
  Tags,
  Contact,
  Truck,
  Boxes,
  Send,
  BarChart3,
  Layers,
  Hammer,
  ShoppingCart,
  Trash2,
  TriangleAlert,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import {
  PERMISSIONS,
  RECYCLE_BIN_PERMISSIONS,
  CATALOG_PAGE_PERMISSIONS,
  ASSET_PAGE_PERMISSIONS,
  WASTAGE_PAGE_PERMISSIONS,
  BUILDS_PAGE_PERMISSIONS,
  DISPATCH_PAGE_PERMISSIONS,
  BOM_PERMISSIONS,
  PROCUREMENT_PAGE_PERMISSIONS,
} from "@/lib/rbac/permissions";

/**
 * The sidebar: what is in it, which group it sits in, and which permission
 * each item needs.
 *
 * Called by: `app-sidebar.tsx`, which filters this list against the signed-in
 * person's permissions and draws the groups in the order of NAV_GROUPS.
 *
 * The groups follow the jobs people do, not the tables underneath. Sixteen of
 * twenty-one items used to sit under one "Management" heading, which made the
 * menu a list to read rather than a place to find things. Now each group is a
 * question someone arrives with — where is my stock, what are we production, what
 * are we buying — and a group with nothing in it for this person is not drawn.
 *
 * Every item declares its own key, so a nav item can never appear for someone
 * the page would then refuse. When you add a page, it needs an entry here, a
 * route in `middleware.ts`, and a gate on the page itself — all three naming
 * the same keys. `npm run audit:access` checks they agree.
 */

export const NAV_GROUPS = {
  home: "Home",
  stock: "Stock",
  admin: "Admin",
  production: "Production",
  buying: "Buying",
  catalog: "Catalog",
  dispatch: "Dispatch",
} as const;

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Visible when the user holds this permission */
  permission?: string;
  /** Visible when the user holds ANY of these permissions */
  anyPermission?: string[];
  group: keyof typeof NAV_GROUPS;
};

export const NAV_ITEMS: NavItem[] = [
  /* ---- Home: yours — the dashboard, what happened, what you deleted ----- */
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, group: "home" },
  {
    label: "Activity Log",
    href: "/activity",
    icon: Activity,
    permission: PERMISSIONS.ACTIVITY_VIEW,
    group: "home",
  },
  {
    label: "Recycle Bin",
    href: "/recycle-bin",
    icon: Trash2,
    // Your own deletions unless you hold recyclebin.scope.all, so it sits with you
    anyPermission: RECYCLE_BIN_PERMISSIONS,
    group: "home",
  },

  /* ---- Stock: where things are, what happened to them, and the reports -- */
  {
    label: "Stock Entries",
    href: "/stock",
    icon: Package,
    // Someone who books goods in without stock.view still needs the way in
    anyPermission: [PERMISSIONS.STOCK_VIEW, PERMISSIONS.STOCK_CREATE],
    group: "stock",
  },
  {
    // "Is there any, and which rack is it on?" — see src/lib/actions/racks.ts
    label: "Find Stock",
    href: "/stock/find",
    icon: MapPin,
    anyPermission: [PERMISSIONS.STOCK_VIEW, PERMISSIONS.STOCK_CREATE],
    group: "stock",
  },
  {
    label: "Assets",
    href: "/assets",
    icon: Boxes,
    // Wider than assets.view: the transfer queue lives here too
    anyPermission: ASSET_PAGE_PERMISSIONS,
    group: "stock",
  },
  {
    label: "Wastage",
    href: "/wastage",
    icon: TriangleAlert,
    // Wider than stock.writeoff.view: the review queue lives here too
    anyPermission: WASTAGE_PAGE_PERMISSIONS,
    group: "stock",
  },
  {
    // Was labelled "Stock", which read as a second copy of Stock Entries
    label: "Stock Report",
    href: "/reports",
    icon: BarChart3,
    permission: PERMISSIONS.REPORTS_VIEW,
    group: "stock",
  },

  /* ---- Admin: people, roles and departments ----------------------------- */
  { label: "Team Members", href: "/users", icon: Users, permission: PERMISSIONS.USERS_VIEW, group: "admin" },
  { label: "Roles", href: "/roles", icon: Shield, permission: PERMISSIONS.ROLES_VIEW, group: "admin" },
  {
    label: "Departments",
    href: "/departments",
    icon: Building2,
    permission: PERMISSIONS.DEPARTMENTS_VIEW,
    group: "admin",
  },

  /* ---- Production: what things are made of, and making them ------------- */
  {
    label: "Bills of Materials",
    href: "/bom",
    icon: Layers,
    anyPermission: BOM_PERMISSIONS,
    group: "production",
  },
  {
    label: "Builds",
    href: "/builds",
    icon: Hammer,
    // Runs, and the Plan tab — which is why fulfilment.view opens it
    anyPermission: BUILDS_PAGE_PERMISSIONS,
    group: "production",
  },

  /* ---- Buying: what we need, what we ordered, who from ------------------ */
  {
    label: "Procurement",
    href: "/procurement",
    icon: ShoppingCart,
    // Needs, orders — and the low-stock alert, so its key opens the page too
    anyPermission: PROCUREMENT_PAGE_PERMISSIONS,
    group: "buying",
  },
  {
    label: "Vendors",
    href: "/vendors",
    icon: Truck,
    anyPermission: [PERMISSIONS.VENDORS_VIEW, PERMISSIONS.VENDORS_CREATE, PERMISSIONS.VENDORS_EDIT],
    group: "buying",
  },

  /* ---- Catalog: what things are ----------------------------------------- */
  {
    label: "Products Catalog",
    href: "/stock/products",
    icon: Tags,
    // Wider than managing the catalog: the request queue lives here too
    anyPermission: CATALOG_PAGE_PERMISSIONS,
    group: "stock",
  },

  /* ---- Dispatch: goods leaving, and who they go to ---------------------- */
  {
    label: "Dispatch",
    href: "/dispatch",
    icon: Send,
    // Consignments, and site requests — which is why the fulfilment keys open it
    anyPermission: DISPATCH_PAGE_PERMISSIONS,
    group: "dispatch",
  },
  {
    label: "Clients",
    href: "/clients",
    icon: Contact,
    anyPermission: [PERMISSIONS.CLIENTS_VIEW, PERMISSIONS.CLIENTS_CREATE, PERMISSIONS.CLIENTS_EDIT],
    group: "dispatch",
  },
  // Settings and My Profile are in the avatar menu at the top right: they are
  // about you and this app, not about stock, so they do not compete with it here.
  // Configuration has been taken out for now, and will come back when needed.
];

