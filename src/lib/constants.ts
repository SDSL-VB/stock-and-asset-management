import {
  LayoutDashboard,
  Users,
  Shield,
  Building2,
  Activity,
  Settings,
  UserCircle,
  Package,
  Tags,
  Contact,
  Truck,
  Boxes,
  Send,
  BarChart3,
  Wrench,
  Layers,
  Hammer,
  ClipboardCheck,
  ShoppingCart,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  PERMISSIONS,
  RECYCLE_BIN_PERMISSIONS,
  DISPATCH_PERMISSIONS,
  CATALOG_PAGE_PERMISSIONS,
  ASSET_PAGE_PERMISSIONS,
  STOCK_CONFIG_PERMISSIONS,
  BOM_PERMISSIONS,
  FULFILMENT_PERMISSIONS,
  PROCUREMENT_PERMISSIONS,
} from "@/lib/rbac/permissions";

/**
 * The sidebar: what is in it, and which permission each item needs.
 *
 * Called by: `app-sidebar.tsx`, which filters this list against the signed-in
 * person's permissions.
 *
 * Every item declares its own key, so a nav item can never appear for someone
 * the page would then refuse. When you add a page, it needs an entry here, a
 * route in `middleware.ts`, and a gate on the page itself — all three naming
 * the same keys.
 */

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Visible when the user holds this permission */
  permission?: string;
  /** Visible when the user holds ANY of these permissions */
  anyPermission?: string[];
  group: "main" | "management" | "system";
};

export const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    group: "main",
  },
  {
    label: "Team Members",
    href: "/users",
    icon: Users,
    permission: PERMISSIONS.USERS_VIEW,
    group: "management",
  },
  {
    label: "Roles",
    href: "/roles",
    icon: Shield,
    permission: PERMISSIONS.ROLES_VIEW,
    group: "management",
  },
  {
    label: "Departments",
    href: "/departments",
    icon: Building2,
    permission: PERMISSIONS.DEPARTMENTS_VIEW,
    group: "management",
  },
  {
    label: "Stock Entries",
    href: "/stock",
    icon: Package,
    // The page accepts either key, so the item has to as well — someone who
    // books goods in without stock.view still needs the way in.
    anyPermission: [PERMISSIONS.STOCK_VIEW, PERMISSIONS.STOCK_CREATE],
    group: "management",
  },
  {
    label: "Assets",
    href: "/assets",
    icon: Boxes,
    // Wider than assets.view: the transfer queue lives here too, so someone who
    // can only ask for one still needs the page.
    anyPermission: ASSET_PAGE_PERMISSIONS,
    group: "management",
  },
  {
    label: "Catalog",
    href: "/stock/products",
    icon: Tags,
    // Wider than managing the catalog: the request queue lives here too.
    anyPermission: CATALOG_PAGE_PERMISSIONS,
    group: "management",
  },
  {
    label: "Vendors",
    href: "/vendors",
    icon: Truck,
    anyPermission: [
      PERMISSIONS.VENDORS_VIEW,
      PERMISSIONS.VENDORS_CREATE,
      PERMISSIONS.VENDORS_EDIT,
    ],
    group: "management",
  },
  {
    label: "Clients",
    href: "/clients",
    icon: Contact,
    anyPermission: [
      PERMISSIONS.CLIENTS_VIEW,
      PERMISSIONS.CLIENTS_CREATE,
      PERMISSIONS.CLIENTS_EDIT,
    ],
    group: "management",
  },
  {
    label: "Bills of Materials",
    href: "/bom",
    icon: Layers,
    anyPermission: BOM_PERMISSIONS,
    group: "management",
  },
  {
    label: "Builds",
    href: "/builds",
    icon: Hammer,
    // bom.view belongs here: the page renders a read-only list of what has been
    // made for anyone holding it, and without this the page was reachable by URL
    // but never linked.
    anyPermission: [PERMISSIONS.BOM_VIEW, PERMISSIONS.BOM_BUILD, PERMISSIONS.BOM_UNBUILD],
    group: "management",
  },
  {
    label: "Fulfilment",
    href: "/fulfilment",
    icon: ClipboardCheck,
    anyPermission: FULFILMENT_PERMISSIONS,
    group: "management",
  },
  {
    label: "Procurement",
    href: "/procurement",
    icon: ShoppingCart,
    anyPermission: PROCUREMENT_PERMISSIONS,
    group: "management",
  },
  {
    label: "Dispatch",
    href: "/dispatch",
    icon: Send,
    anyPermission: DISPATCH_PERMISSIONS,
    group: "management",
  },
  {
    label: "Reports",
    href: "/reports",
    icon: BarChart3,
    permission: PERMISSIONS.REPORTS_VIEW,
    group: "management",
  },
  {
    label: "Activity Log",
    href: "/activity",
    icon: Activity,
    permission: PERMISSIONS.ACTIVITY_VIEW,
    group: "management",
  },
  {
    label: "Configuration",
    href: "/configure",
    icon: Wrench,
    anyPermission: STOCK_CONFIG_PERMISSIONS,
    group: "system",
  },
  {
    label: "Recycle Bin",
    href: "/recycle-bin",
    icon: Trash2,
    anyPermission: RECYCLE_BIN_PERMISSIONS,
    group: "system",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    permission: PERMISSIONS.SETTINGS_VIEW,
    group: "system",
  },
  {
    label: "My Profile",
    href: "/settings/profile",
    icon: UserCircle,
    group: "system",
  },
];

export const NAV_GROUPS: Record<string, string> = {
  main: "Main",
  management: "Management",
  system: "System",
};
