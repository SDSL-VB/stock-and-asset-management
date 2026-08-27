/**
 * Every permission in the system, grouped by the module it belongs to.
 *
 * This is the ONE definition. `seed.ts` creates these rows on a new database
 * and `setup-roles-and-people.ts` hands them out; nothing else invents a key.
 *
 * A permission is a capability, never a job title. If you are adding one:
 *   1. the key here, with a description a non-programmer can read
 *   2. the constant in `src/lib/rbac/permissions.ts`
 *   3. `requirePermission(...)` on the action, and hide the UI without it
 *   4. the route in `middleware.ts` if it opens a page
 *   5. `npm run docs:permissions` to rewrite permissions.md
 */

export type PermissionDefinition = {
  key: string;
  name: string;
  module: string;
  description: string;
};

export const PERMISSION_CATALOG: PermissionDefinition[] = [
  // ---- users ---------------------------------------------------------------
  {
    key: "users.create",
    name: "Create Users",
    module: "users",
    description:
      "Can add new team members",
  },
  {
    key: "users.delete",
    name: "Delete Users",
    module: "users",
    description:
      "Can deactivate user accounts",
  },
  {
    key: "users.edit",
    name: "Edit Users",
    module: "users",
    description:
      "Can edit user details",
  },
  {
    key: "users.password.edit",
    name: "Change Passwords",
    module: "users",
    description:
      "Can set a new password for a user from their profile",
  },
  {
    key: "users.password.view",
    name: "View Passwords",
    module: "users",
    description:
      "Can reveal a user's password on their profile (only passwords set through the app can be revealed)",
  },
  {
    key: "users.permissions.grant",
    name: "Grant Extra Permissions",
    module: "users",
    description:
      "Can give one person a permission their role does not carry. Grants only, never to yourself, and never a permission you do not hold",
  },
  {
    key: "users.view",
    name: "View Users",
    module: "users",
    description:
      "Can view user list and profiles",
  },

  // ---- roles ---------------------------------------------------------------
  {
    key: "roles.create",
    name: "Create Roles",
    module: "roles",
    description:
      "Can create new roles",
  },
  {
    key: "roles.delete",
    name: "Delete Roles",
    module: "roles",
    description:
      "Can delete roles",
  },
  {
    key: "roles.edit",
    name: "Edit Roles",
    module: "roles",
    description:
      "Can edit role permissions",
  },
  {
    key: "roles.view",
    name: "View Roles",
    module: "roles",
    description:
      "Can view roles",
  },

  // ---- departments ---------------------------------------------------------
  {
    key: "departments.create",
    name: "Create Departments",
    module: "departments",
    description:
      "Can create departments",
  },
  {
    key: "departments.delete",
    name: "Delete Departments",
    module: "departments",
    description:
      "Can delete departments",
  },
  {
    key: "departments.edit",
    name: "Edit Departments",
    module: "departments",
    description:
      "Can edit departments",
  },
  {
    key: "departments.view",
    name: "View Departments",
    module: "departments",
    description:
      "Can view departments",
  },

  // ---- vendors -------------------------------------------------------------
  {
    key: "vendors.create",
    name: "Add Vendors",
    module: "vendors",
    description:
      "Can add new vendors",
  },
  {
    key: "vendors.delete",
    name: "Delete Vendors",
    module: "vendors",
    description:
      "Can permanently remove a vendor record",
  },
  {
    key: "vendors.edit",
    name: "Edit Vendors",
    module: "vendors",
    description:
      "Can edit vendor details and activate/deactivate vendors",
  },
  {
    key: "vendors.export",
    name: "Export the Vendor List",
    module: "vendors",
    description:
      "Can download the vendor list, with GST numbers and addresses, as a CSV",
  },
  {
    key: "vendors.view",
    name: "View Vendors",
    module: "vendors",
    description:
      "Can see the vendor list with GST numbers and addresses",
  },

  // ---- clients -------------------------------------------------------------
  {
    key: "clients.create",
    name: "Add Clients",
    module: "clients",
    description:
      "Can add new clients",
  },
  {
    key: "clients.delete",
    name: "Delete Clients",
    module: "clients",
    description:
      "Can permanently remove a client record",
  },
  {
    key: "clients.edit",
    name: "Edit Clients",
    module: "clients",
    description:
      "Can edit client details and activate/deactivate clients",
  },
  {
    key: "clients.export",
    name: "Export the Client List",
    module: "clients",
    description:
      "Can download the client list, with GST numbers and addresses, as a CSV",
  },
  {
    key: "clients.view",
    name: "View Clients",
    module: "clients",
    description:
      "Can see the client list and a client's GST number and address on outgoing stock",
  },

  // ---- products ------------------------------------------------------------
  {
    key: "categories.create",
    name: "Add Categories",
    module: "products",
    description:
      "Can add new product categories",
  },
  {
    key: "categories.delete",
    name: "Delete Categories",
    module: "products",
    description:
      "Can permanently remove a category, as opposed to deactivating it",
  },
  {
    key: "categories.edit",
    name: "Edit Categories",
    module: "products",
    description:
      "Can rename product categories",
  },
  {
    key: "categories.prefix.edit",
    name: "Edit Code Prefixes",
    module: "products",
    description:
      "Can change the fixed 4-digit code prefix a category assigns to its products (e.g. 1001)",
  },
  {
    key: "categories.request.approve",
    name: "Answer a Category Request",
    module: "products",
    description:
      "Can approve or decline a category request. Approving creates the category",
  },
  {
    key: "categories.request.create",
    name: "Ask For a Category",
    module: "products",
    description:
      "Can ask for a new product category",
  },
  {
    key: "products.code.override",
    name: "Override Product Codes",
    module: "products",
    description:
      "Can type a product code by hand instead of using the one generated from the category prefix",
  },
  {
    key: "products.create",
    name: "Add a Raw Material",
    module: "products",
    description:
      "Can add a raw material — something we buy in and consume. Adding a product we make is products.create.made",
  },
  {
    key: "products.create.made",
    name: "Add a Product",
    module: "products",
    description:
      "Can add a finished or complete product — something we make. Adding a raw material we buy in is products.create",
  },
  {
    key: "products.delete",
    name: "Delete Products",
    module: "products",
    description:
      "Can permanently remove a product, as opposed to deactivating it",
  },
  {
    key: "products.edit",
    name: "Edit Products",
    module: "products",
    description:
      "Can edit product codes and names, and activate/deactivate products",
  },
  {
    key: "products.request.approve",
    name: "Answer a Product Request",
    module: "products",
    description:
      "Can approve or decline a product request. Approving creates the product",
  },
  {
    key: "products.request.create",
    name: "Ask For a Product",
    module: "products",
    description:
      "Can ask for a product to be added to the catalog",
  },
  {
    key: "products.view",
    name: "View Products",
    module: "products",
    description:
      "Can view and search the product code catalog",
  },

  // ---- stock ---------------------------------------------------------------
  {
    key: "stock.approve",
    name: "Approve Stock Entries",
    module: "stock",
    description:
      "Can approve or reject stock entries",
  },
  {
    key: "stock.batch.edit",
    name: "Set Batch Number",
    module: "stock",
    description:
      "Can set the batch a stock entry belongs to. Dispatch inherits the batch, so this is the only place it is typed",
  },
  {
    key: "stock.config.attachments",
    name: "Configure Attachment Types",
    module: "stock",
    description:
      "Can configure attachment/document types for stock entries",
  },
  {
    key: "stock.config.fields",
    name: "Configure Entry Fields",
    module: "stock",
    description:
      "Can configure custom stock entry fields",
  },
  {
    key: "stock.config.flows",
    name: "Configure Approval Flows",
    module: "stock",
    description:
      "Can configure stock approval workflows",
  },
  {
    key: "stock.create",
    name: "Create Stock Entries",
    module: "stock",
    description:
      "Can create stock entries",
  },
  {
    key: "stock.edit",
    name: "Edit Stock Entries",
    module: "stock",
    description:
      "Can edit stock entries",
  },
  {
    key: "stock.move",
    name: "Move Stock",
    module: "stock",
    description:
      "Can move approved stock directly into a department (without a transfer request)",
  },
  {
    key: "stock.scope.all",
    name: "See All Stock",
    module: "stock",
    description:
      "Visibility scope: every stock entry across the organisation",
  },
  {
    key: "stock.scope.department",
    name: "See Department Stock",
    module: "stock",
    description:
      "Visibility scope: own department's stock plus central stock",
  },
  {
    key: "stock.scope.location",
    name: "See Location Stock",
    module: "stock",
    description:
      "Visibility scope: every department's stock plus central stock, within the user's own location",
  },
  {
    key: "stock.scope.own",
    name: "See Own Entries Only",
    module: "stock",
    description:
      "Visibility scope: only stock entries the user created",
  },
  {
    key: "stock.value.view",
    name: "View Stock Value",
    module: "stock",
    description:
      "Can see prices and monetary values of stock",
  },
  {
    key: "stock.view",
    name: "View Stock Entries",
    module: "stock",
    description:
      "Can view stock entries",
  },
  {
    key: "stock.warranty.edit",
    name: "Record Warranty Details",
    module: "stock",
    description:
      "Can add or change the warranty and registration details of a stock entry",
  },
  {
    key: "stock.warranty.view",
    name: "View Warranty Details",
    module: "stock",
    description:
      "Can see warranty and registration details on a stock entry — purchase date, model and serial number, warranty expiry",
  },

  // ---- assets --------------------------------------------------------------
  {
    key: "assets.create",
    name: "Create Assets",
    module: "assets",
    description:
      "Can add new assets",
  },
  {
    key: "assets.transfer.approve",
    name: "Answer a Transfer Request",
    module: "assets",
    description:
      "Can agree to or decline transfers into their own department. Agreeing IS the movement",
  },
  {
    key: "assets.transfer.request",
    name: "Ask For a Transfer",
    module: "assets",
    description:
      "Can ask for central stock to be moved into a department. Their department's manager decides",
  },
  {
    key: "assets.view",
    name: "View Assets",
    module: "assets",
    description:
      "Can view assets",
  },

  // ---- bom -----------------------------------------------------------------
  {
    key: "bom.approve",
    name: "Approve a Bill of Materials",
    module: "bom",
    description:
      "Can approve a submitted bill of materials, which publishes it and retires whatever was in force. Approving your own work is refused",
  },
  {
    key: "bom.build",
    name: "Build From a Bill of Materials",
    module: "bom",
    description:
      "Can consume components out of central stock and book the assembled product in, so it can be dispatched as a whole",
  },
  {
    key: "bom.build.finish",
    name: "Finish a Build",
    module: "bom",
    description:
      "Can book finished work into stock, in whole or in part, and close a run that will not be completed",
  },
  {
    key: "bom.create",
    name: "Write a Bill of Materials",
    module: "bom",
    description:
      "Can write a bill of materials and submit it. It is published when someone with bom.approve approves it, unless the author also holds bom.publish",
  },
  {
    key: "bom.delete",
    name: "Delete a Bill of Materials",
    module: "bom",
    description:
      "Can permanently remove a version. Refused for any version something was built to",
  },
  {
    key: "bom.edit",
    name: "Correct the Active Bill of Materials",
    module: "bom",
    description:
      "Can change the version currently in force, and put an older published version back in force",
  },
  {
    key: "bom.publish",
    name: "Publish Without Approval",
    module: "bom",
    description:
      "Can publish a bill of materials straight away instead of sending it for approval",
  },
  {
    key: "bom.unbuild",
    name: "Undo a Build",
    module: "bom",
    description:
      "Can reverse a build and return its components, while nothing has been moved or dispatched from what it produced",
  },
  {
    key: "bom.view",
    name: "View Bills of Materials",
    module: "bom",
    description:
      "Can see what a product is made of — its components, quantities and versions",
  },

  // ---- dispatch ------------------------------------------------------------
  {
    key: "dispatch.accept",
    name: "Accept Dispatches",
    module: "dispatch",
    description:
      "Can accept or reject a consignment arriving at their location",
  },
  {
    key: "dispatch.create",
    name: "Raise Dispatches",
    module: "dispatch",
    description:
      "Can send central stock from their location to another location or to a client",
  },
  {
    key: "dispatch.export",
    name: "Export Dispatch Report",
    module: "dispatch",
    description:
      "Can download the dispatch report as a CSV",
  },
  {
    key: "dispatch.receive",
    name: "Confirm Delivery",
    module: "dispatch",
    description:
      "Can mark a consignment in transit as received, which books it into central stock at the destination",
  },
  {
    key: "dispatch.view",
    name: "View Dispatches",
    module: "dispatch",
    description:
      "Can see outgoing consignments for their location, both leaving and arriving, and trace batch numbers",
  },

  // ---- fulfilment ----------------------------------------------------------
  {
    key: "fulfilment.approve",
    name: "Answer a Site Request",
    module: "fulfilment",
    description:
      "Can agree to or decline another site's request. Agreeing raises a dispatch from this site",
  },
  {
    key: "fulfilment.request",
    name: "Request Stock From Another Site",
    module: "fulfilment",
    description:
      "Can ask a site that is holding stock to send some of it here",
  },
  {
    key: "fulfilment.view",
    name: "View Fulfilment",
    module: "fulfilment",
    description:
      "Can check whether an order can be met, which sites hold the stock, and what could be built",
  },

  // ---- procurement ---------------------------------------------------------
  {
    key: "procurement.intent.approve",
    name: "Verify a Need",
    module: "procurement",
    description:
      "Can verify or decline a stated need, deciding what is worth ordering",
  },
  {
    key: "procurement.intent.create",
    name: "State a Need",
    module: "procurement",
    description:
      "Can ask for something to be bought in, and withdraw a request they raised",
  },
  {
    key: "procurement.intent.view",
    name: "View Stated Needs",
    module: "procurement",
    description:
      "Can see what has been asked for, and what happened to each request",
  },
  {
    key: "procurement.po.close",
    name: "Close a Purchase Order",
    module: "procurement",
    description:
      "Can close an order short when the rest will never arrive, and cancel one nothing has arrived against",
  },
  {
    key: "procurement.po.create",
    name: "Place a Purchase Order",
    module: "procurement",
    description:
      "Can raise an order with a vendor, setting quantities and agreed prices",
  },
  {
    key: "procurement.po.view",
    name: "View Purchase Orders",
    module: "procurement",
    description:
      "Can see orders placed with vendors and how much of each is still owed",
  },
  {
    key: "procurement.value.view",
    name: "View Order Values",
    module: "procurement",
    description:
      "Can see unit prices and totals on purchase orders. Without it an order shows quantities only",
  },

  // ---- activity ------------------------------------------------------------
  {
    key: "activity.scope.all",
    name: "Activity: Everyone's Actions",
    module: "activity",
    description:
      "Visibility scope: every action by every person",
  },
  {
    key: "activity.scope.department",
    name: "Activity: Own Department",
    module: "activity",
    description:
      "Visibility scope: actions by their department's members, and actions done to them",
  },
  {
    key: "activity.scope.own",
    name: "Activity: Own Actions Only",
    module: "activity",
    description:
      "Visibility scope: only what this person did themselves",
  },
  {
    key: "activity.view",
    name: "Open the Activity Log",
    module: "activity",
    description:
      "Can open the activity log. What is visible on it depends on the activity.view.* permissions",
  },
  {
    key: "activity.view.catalog",
    name: "Activity: Catalog",
    module: "activity",
    description:
      "Can read log entries about products, categories, vendors and clients",
  },
  {
    key: "activity.view.making",
    name: "Activity: Making",
    module: "activity",
    description:
      "Can read log entries about bills of materials and builds",
  },
  {
    key: "activity.view.movement",
    name: "Activity: Stock Out",
    module: "activity",
    description:
      "Can read log entries about issues, transfers and dispatches",
  },
  {
    key: "activity.view.people",
    name: "Activity: People",
    module: "activity",
    description:
      "Can read log entries about team members, roles, departments and sites",
  },
  {
    key: "activity.view.procurement",
    name: "Activity: Buying",
    module: "activity",
    description:
      "Can read log entries about stated needs and purchase orders",
  },
  {
    key: "activity.view.security",
    name: "Activity: Security & Settings",
    module: "activity",
    description:
      "Can read password reveals, permission grants, deletions and configuration changes — the most sensitive part of the log",
  },
  {
    key: "activity.view.stock",
    name: "Activity: Stock In",
    module: "activity",
    description:
      "Can read log entries about stock entries, their documents and approvals",
  },

  // ---- reports -------------------------------------------------------------
  {
    key: "reports.export",
    name: "Export Reports",
    module: "reports",
    description:
      "Can export stock reports to CSV",
  },
  {
    key: "reports.view",
    name: "View Reports",
    module: "reports",
    description:
      "Can view stock reports",
  },

  // ---- recyclebin ----------------------------------------------------------
  {
    key: "recyclebin.purge",
    name: "Empty the Recycle Bin",
    module: "recyclebin",
    description:
      "Can remove an entry from the recycle bin for good, before it ages out on its own",
  },
  {
    key: "recyclebin.restore",
    name: "Restore Deleted Records",
    module: "recyclebin",
    description:
      "Can put a deleted record back, along with whatever was unlinked when it went",
  },
  {
    key: "recyclebin.scope.all",
    name: "See Everyone's Deletions",
    module: "recyclebin",
    description:
      "Visibility scope: everything anyone deleted, not just their own",
  },
  {
    key: "recyclebin.scope.own",
    name: "See Own Deletions",
    module: "recyclebin",
    description:
      "Visibility scope: only what this person deleted themselves",
  },
  {
    key: "recyclebin.view",
    name: "View the Recycle Bin",
    module: "recyclebin",
    description:
      "Can see what has been deleted recently and who deleted it",
  },

  // ---- config --------------------------------------------------------------
  {
    key: "config.flows.bom",
    name: "Configure the BOM Approval Flow",
    module: "config",
    description:
      "Can set who approves a bill of materials before it counts. One rule for the whole company",
  },
  {
    key: "config.flows.procurement",
    name: "Configure the Procurement Flow",
    module: "config",
    description:
      "Can decide whether a stated need must be verified before it can be ordered",
  },

  // ---- settings ------------------------------------------------------------
  {
    key: "settings.edit",
    name: "Edit Settings",
    module: "settings",
    description:
      "Can edit settings",
  },
  {
    key: "settings.view",
    name: "View Settings",
    module: "settings",
    description:
      "Can view settings",
  },
];
