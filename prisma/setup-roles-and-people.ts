/**
 * Who can do what: the roles, and which of them each person holds.
 *
 *   npx tsx prisma/setup-roles-and-people.ts
 *
 * This is the single definition. `seed.ts` calls into it for a fresh database,
 * and running it directly brings a live one back in line. Idempotent: it sets
 * each role to EXACTLY the list below, so deleting a key here removes it.
 *
 * Two ideas run through it.
 *
 *   Jobs are not job titles. Buyer and Dispatch Operator can sit ON TOP of
 *   whatever else someone does, given to individual people, so one account
 *   can hold several roles rather than a pile of exceptions.
 *
 *   Nothing is granted by role NAME in the application. These lists decide
 *   everything; the code only ever asks "do they hold this key?".
 *
 * It also brings the permission TABLE in line with prisma/lib/permission-catalog.ts
 * before handing anything out, so a newly added key exists on a live database
 * by the time a role asks for it. That step only adds keys; it never deletes
 * one, and never overwrites a name or description edited in the app.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { PERMISSION_CATALOG } from "./lib/permission-catalog";

/** What a newly created account gets. Change it on first sign-in. */
export const DEFAULT_PASSWORD = "Welcome@123!";

/** Everyone can undo their own mistakes, and only their own. */
const OWN_RECYCLE_BIN = [
  "recyclebin.view",
  "recyclebin.restore",
  "recyclebin.scope.own",
];

/**
 * A department manager's duties — shared by the Department, Production and
 * R&D Manager roles, each for its own department. Moving anything out of
 * central stock is the Stock Manager's, so it is not here: a manager agrees
 * their people's requests (step 1) and the Stock Manager moves the goods.
 */
const DEPARTMENT_MANAGER_KEYS = [
  "users.view",
  // Their department's stock, plus their site's central stock to ask from
  "stock.view", "stock.scope.department", "stock.warranty.view",
  "reports.view",
  // Asking for materials and assets, and agreeing what their people ask for
  "materials.request", "materials.approve.department",
  "assets.view", "assets.transfer.request", "assets.transfer.department",
  // Damage in their department: raised here, approved by the Stock Manager
  "stock.writeoff.view", "stock.writeoff.create", "stock.writeoff.department",
  // Their department's history only
  "activity.view", "activity.scope.department",
  "activity.view.people", "activity.view.stock", "activity.view.movement",
  ...OWN_RECYCLE_BIN,
];

/** What an engineer in any department starts from. */
const ENGINEER_KEYS = [
  // Their department's stock plus their site's central stock
  "stock.view", "stock.scope.department",
  // Asking, never doing: their manager and the Stock Manager decide
  "assets.view", "assets.transfer.request",
  // Reporting damage on what their department holds
  "stock.writeoff.view", "stock.writeoff.department",
  "products.request.create", "categories.request.create",
  ...OWN_RECYCLE_BIN,
];

/**
 * Building, for Production. Readiness only, not the recipe (no bom.view), and
 * from the department's own stock. Batch numbers are set only here.
 */
const BUILDING_KEYS = [
  "bom.build", "bom.build.finish", "bom.unbuild", "builds.view", "stock.batch.edit",
];

/**
 * Prices, of any kind, belong to Accounts and Admin only (and Super Admin, who
 * holds everything). Two keys carry them: `stock.value.view` for stock, and
 * `procurement.value.view` for purchase orders. Nobody else is given either.
 * Typing a price — off an invoice, onto a new order — is data entry and needs
 * neither; SEEING prices already in the system does.
 *
 * Exported so prisma/sync-role-permissions.ts brings a live database into line
 * from this same list, without touching anybody's account.
 */
export const ROLE_DEFINITIONS: Record<string, { description: string; hierarchyLevel: number; keys: string[] }> = {
  "Super Admin": {
    description: "Everything, everywhere. The account of last resort.",
    hierarchyLevel: 0,
    keys: [], // filled with every permission below
  },

  Admin: {
    description:
      "Runs the organisation: people, roles, departments, the catalog, vendors, clients and buying. No stock, no reports.",
    hierarchyLevel: 1,
    keys: [
      // People
      "users.view", "users.create", "users.edit", "users.delete",
      "users.password.view", "users.password.edit", "users.permissions.grant",
      "roles.view", "roles.create", "roles.edit", "roles.delete", "permissions.rename",
      "locations.create", "locations.edit", "approvals.configure",
      "departments.view", "departments.create", "departments.edit", "departments.delete",
      // Masters
      "vendors.view", "vendors.create", "vendors.edit", "vendors.delete", "vendors.export",
      "clients.view", "clients.create", "clients.edit", "clients.delete", "clients.export",
      // Catalog, including approving what operators ask for
      "products.view", "products.create", "products.create.made", "products.edit",
      "products.delete", "products.code.override",
      "categories.create", "categories.edit", "categories.delete", "categories.prefix.edit",
      "products.request.create", "products.request.approve",
      "categories.request.create", "categories.request.approve",
      "assets.view",
      // Granted through the Roles page after this list was first written —
      // seeing stock entries, moving stock into departments and registering
      // assets. The database is the more recent decision, so it is followed.
      "stock.view", "stock.move", "assets.create",
      // Every site. This used to be inferred from the role being NAMED
      // "Admin"; saying it outright means renaming the role cannot quietly
      // change what an admin can see.
      "stock.scope.all",
      // Buying, end to end, including the rule about whether needs are verified
      "procurement.intent.view", "procurement.intent.create", "procurement.intent.approve",
      "procurement.po.view", "procurement.po.create", "procurement.po.close",
      "procurement.value.view", "config.flows.procurement",
      // Prices are Accounts' and Admin's — stock value as well as order value
      "stock.value.view",
      // Service stock: seeing it and approving it
      "stock.service.view", "stock.service.approve",
      // They own the catalog, so they decide how strict it is
      "config.catalog",
      // History of the things they run — not goods movements, not passwords
      "activity.view", "activity.scope.all",
      "activity.view.people", "activity.view.catalog", "activity.view.procurement",
      // Settings and the bin
      "settings.view", "settings.edit",
      "recyclebin.view", "recyclebin.restore", "recyclebin.purge", "recyclebin.scope.all",
    ],
  },

  /* --- running the stock -------------------------------------------- */

  "Stock Manager": {
    description:
      "Runs its site's central stock: approves what arrives, call-back returns and write-offs; moves stock and assets into departments; supplies material requests. Sees prices only while approving.",
    hierarchyLevel: 2,
    keys: [
      // Approving at its own site. No stock.view: after approving it works
      // from Find Stock and its approval queue, not the entries list. The price
      // shows only on an entry waiting for its approval.
      "stock.approve", "stock.value.approving", "stock.find", "stock.scope.location",
      "stock.warranty.view",
      // Whether goods are an asset is its call, once they are received
      "stock.classify",
      // Moving stock and assets into departments (step 2 of a request, or
      // allocating outright), and what has gone where
      "assets.view", "assets.create", "stock.move",
      "assets.transfer.request", "assets.transfer.approve", "assets.report.view",
      // Supplying what departments ask for; a need for what is not in stock
      "materials.supply",
      "procurement.intent.view", "procurement.intent.create",
      // Write-offs are its second check; its own are approved on raising
      "stock.writeoff.view", "stock.writeoff.create", "stock.writeoff.approve",
      // Told about call-backs; approves the returns as stock entries
      "callbacks.view",
      // Quantities only — no stock.value.view
      "reports.view",
      ...OWN_RECYCLE_BIN,
    ],
  },

  /* --- departments: managers and engineers ------------------------------ */

  "Department Manager": {
    description:
      "Runs a department other than Production and R&D: its stock, its people's requests for materials and assets, and its write-offs.",
    hierarchyLevel: 2,
    keys: DEPARTMENT_MANAGER_KEYS,
  },

  "Production Manager": {
    description:
      "Runs Production: a department manager's duties, plus building, approving what is built, and calling built goods back.",
    hierarchyLevel: 2,
    keys: [
      ...DEPARTMENT_MANAGER_KEYS,
      ...BUILDING_KEYS,
      // Finished units come to this role; its own builds approve on finishing
      "bom.build.approve",
      // Calling a batch back into Production, for any reason
      "callbacks.raise", "callbacks.view",
      "activity.view.making",
    ],
  },

  "R&D Manager": {
    description:
      "Runs R&D: a department manager's duties, plus approving bills of materials — and publishing its own without review.",
    hierarchyLevel: 2,
    keys: [
      ...DEPARTMENT_MANAGER_KEYS,
      "bom.view", "bom.create", "bom.edit", "bom.approve", "bom.publish",
      // R&D states needs, with the product request for a new item
      "procurement.intent.view", "procurement.intent.create",
      "products.request.create", "categories.request.create",
      "activity.view.making",
    ],
  },

  "Production Engineer": {
    description:
      "Builds from Production's own stock, asks central stock for what is missing, raises needs, and asks for assets.",
    hierarchyLevel: 4,
    keys: [
      ...ENGINEER_KEYS,
      ...BUILDING_KEYS,
      "materials.request",
      "procurement.intent.view", "procurement.intent.create",
    ],
  },

  "R&D Engineer": {
    description:
      "Drafts and submits bills of materials, raises needs, and asks for assets.",
    hierarchyLevel: 4,
    keys: [
      ...ENGINEER_KEYS,
      // Drafting; the R&D Manager approves
      "bom.view", "bom.create",
      "procurement.intent.view", "procurement.intent.create",
    ],
  },

  "Software Development Engineer": {
    description: "No permissions yet.",
    hierarchyLevel: 4,
    keys: [],
  },

  "Stock Entry Operator": {
    description:
      "Enters stock, and only that. Sees an entry while it is theirs to write or correct; once submitted it leaves their view.",
    hierarchyLevel: 3,
    keys: [
      // Entering. No stock.view: without it they see only their own entries
      // still in their hands — drafts, and ones sent back to correct — and never
      // one that is submitted or approved (src/lib/stock-visibility.ts). Editing
      // their own draft needs no stock.edit; that key is for other people's.
      // (Holding no scope key is the same as stock.scope.own.) No batch
      // numbers: those are set only by Production, when building.
      "stock.create",
      // Warranty details are entered with the goods they belong to.
      // stock.scope.own and stock.warranty.view were removed through the Roles
      // page after this list was written; the database is followed.
      "stock.warranty.edit",
      // No products.view: the entry form's product search runs on stock.create
      // (PRODUCT_PICK_PERMISSIONS), and the Catalog page stays closed to them.
      // Asking for a product or category that is missing — from the entry form
      "products.request.create", "categories.request.create",
      // Booking in goods returned on a call-back
      "callbacks.receive",
      // Nothing else: no prices, no BOMs, builds, procurement, dispatch, wastage
      // or recycle bin. Notifications of approval and rejection reach them
      // regardless — they go to whoever raised the entry.
    ],
  },

  "Service Operator": {
    description:
      "Looks after goods received for service: approves them into service stock, and writes them off or sends them out. Sees service stock at their own site and nothing of central stock.",
    hierarchyLevel: 3,
    keys: [
      // Service stock at their own site. No stock.view and no stock.create —
      // goods are booked in (and tagged for service) by whoever receives them,
      // and without either key Find Stock and central stock stay closed.
      "stock.service.view", "stock.service.approve", "stock.scope.location",
      // Writing service stock off, and sending it out; the stock picker offers
      // them service stock only
      "stock.writeoff.view", "stock.writeoff.create",
      "dispatch.view", "dispatch.create",
      // Told about call-backs to follow up with customers; books the returns
      // in and swaps parts on site
      "callbacks.view", "callbacks.receive", "service.swap",
    ],
  },

  "Dispatch Operator": {
    description:
      "Moves goods out: consignments to other sites and to clients, and answering other sites' requests.",
    hierarchyLevel: 3,
    keys: [
      "dispatch.view", "dispatch.create", "dispatch.accept", "dispatch.receive",
      "dispatch.export",
      // Check readiness, ask another site, answer their asks
      "fulfilment.view", "fulfilment.request", "fulfilment.approve",
      // stock.view, stock.scope.location, stock.warranty.view, products.view
      // and bom.view were removed through the Roles page after this list was
      // written; the database is followed. The dispatch form still offers
      // their own site's stock to send.
      ...OWN_RECYCLE_BIN,
    ],
  },


  Accounts: {
    description:
      "Sees what everything costs: stock value, order prices and the reports built on them. Moves stock and assets into departments, at every site.",
    hierarchyLevel: 2,
    keys: [
      // Prices of both kinds — the reason this role exists
      "stock.value.view", "procurement.value.view",
      // Service stock: seeing it and approving it
      "stock.service.view", "stock.service.approve",
      // Enough to read them in context, across every site
      "stock.view", "stock.scope.all",
      "procurement.po.view",
      "reports.view", "reports.export",
      "products.view",
      // Asset transfers, with the Stock Manager
      "assets.view", "assets.transfer.request", "assets.transfer.approve", "assets.report.view",
    ],
  },

  Buyer: {
    description:
      "Held on top of another role. Verifies what is needed and turns it into orders.",
    hierarchyLevel: 2,
    keys: [
      "procurement.intent.view", "procurement.intent.create", "procurement.intent.approve",
      "procurement.po.view", "procurement.po.create", "procurement.po.close",
      // No procurement.value.view: a buyer types the agreed price onto a new
      // order, but prices already in the system are Accounts' and Admin's
      "vendors.view", "products.view",
      "activity.view", "activity.view.procurement",
    ],
  },
};

/** Stripped of permissions once nobody holds them. Kept, not deleted: their
 *  names appear on historic records. Auditor was removed; Engineer split into
 *  the three engineer roles; Stock Approver became Stock Manager; Builder
 *  folded into the Production roles. */
const RETIRED_ROLES = ["Central Stock Manager", "Staff", "Auditor", "Engineer", "Stock Approver", "Builder"];

type Person = {
  email: string;
  name: string;
  primaryRole: string;
  additionalRoles?: string[];
  department: string | null;
  /** Only used when the account has to be created */
  newPassword?: string;
  /** Rename an existing account rather than orphan its history */
  renameFrom?: string;
};

const PEOPLE: Person[] = [
  { email: "superadmin@straightdrivesport.com", name: "Phani Raj", primaryRole: "Super Admin", department: null },
  {
    email: "shravani@straightdrivesport.com",
    name: "Shravani",
    primaryRole: "Admin",
    department: null,
    renameFrom: "admin@straightdrivesport.com",
  },
  {
    email: "nagarajan@straightdrivesport.com",
    name: "Nagarajan",
    primaryRole: "Accounts",
    additionalRoles: ["Buyer"],
    department: "Accounts",
    newPassword: "Audit@123!",
  },
  {
    email: "kiruba@straightdrivesport.com",
    name: "Kirubakaran",
    primaryRole: "Production Manager",
    // Runs Production, does the buying, and approves goods at Bengaluru
    additionalRoles: ["Buyer", "Stock Manager"],
    department: "Production",
  },
  { email: "manu@straightdrivesport.com", name: "Manohar", primaryRole: "R&D Manager", department: "R&D" },
  { email: "deepanjona@straightdrivesport.com", name: "Deepanjona", primaryRole: "Production Engineer", department: "Production" },
  { email: "raghava@straightdrivesport.com", name: "Raghava", primaryRole: "R&D Engineer", department: "R&D" },
  {
    email: "uday@straightdrivesport.com",
    name: "Uday Kherkatary",
    primaryRole: "Stock Entry Operator",
    additionalRoles: ["Dispatch Operator"],
    department: "Central Stock — Bengaluru",
  },
  {
    email: "spandana@straightdrivesport.com",
    name: "Spandana",
    primaryRole: "Stock Entry Operator",
    department: "Central Stock — Bengaluru",
  },
  {
    email: "ashish@straightdrivesport.com",
    name: "Ashish",
    primaryRole: "Dispatch Operator",
    department: "Dispatch Hyd",
    renameFrom: "dispatchhyd@straightdrivesport.com",
  },
];

/** Uday covers Bengaluru dispatch through his second role. */
const DEACTIVATE = ["dispatchblore@straightdrivesport.com"];

/**
 * Permissions held by ONE person rather than through a role — the exception,
 * with the reason written down, because "why can he do that?" must always have
 * an answer.
 *
 * Each person listed here ends up with exactly these grants and no others, so
 * an entry is also how a stale grant is removed. Someone not listed is left
 * alone. When a grant here becomes a job several people do, move it into a role
 * and delete the line.
 */
const INDIVIDUAL_GRANTS: { email: string; keys: string[]; reason: string }[] = [
  {
    email: "kiruba@straightdrivesport.com",
    keys: ["stock.lowstock.view", "stock.lowstock.manage"],
    reason: "Watches stock levels and reorders while low stock has no role of its own",
  },
];

/** Somewhere to send progress. The seed indents it; the script prints plainly. */
type Options = {
  log?: (line: string) => void;
  /**
   * The known starting passwords above (DEFAULT_PASSWORD, and any
   * `newPassword`) are for a local or test database made by the seed. Run on
   * its own — against a real database — every NEW account gets a random
   * starting password instead, printed once below; a password written in this
   * file is a password anyone who reads the code knows.
   */
  knownPasswords?: boolean;
  /**
   * Only these accounts are created or updated (and only their grants and
   * deactivations applied). For a fresh install that starts with Super Admin
   * and Admin alone — see prisma/fresh-start.ts.
   */
  onlyEmails?: string[];
};

/**
 * Creates or updates every role and every person, and points the stock approval
 * flow at a role somebody actually holds.
 *
 * Takes the Prisma client as an argument so the seed can pass its own, rather
 * than two clients competing over the same rows.
 */
export async function applyRolesAndPeople(prisma: PrismaClient, options: Options = {}) {
  const log = options.log ?? ((line: string) => console.log(line));
  const included = (email: string) => !options.onlyEmails || options.onlyEmails.includes(email);

  /* --- the permission catalog ----------------------------------------- */
  //
  // Without this, adding a permission to a LIVE database had no working path:
  // the only thing that created permission rows was seed.ts, which wipes
  // everything first. So a new key existed in the catalog and in a role list
  // here, and this script then refused it as unknown.
  //
  // Upsert, never delete. A key missing from the catalog is left in the table
  // rather than removed, because removing it would silently strip it from every
  // role and person that holds it — that deserves a deliberate migration.
  const before = await prisma.permission.count();
  await prisma.$transaction(
    PERMISSION_CATALOG.map((definition) =>
      prisma.permission.upsert({
        where: { key: definition.key },
        // Names and descriptions are edited in the app (Permission Names page),
        // so only a new key takes them from the catalog
        update: { module: definition.module },
        create: definition,
      })
    )
  );
  const added = (await prisma.permission.count()) - before;
  log(`permission catalog: ${PERMISSION_CATALOG.length} keys${added > 0 ? `, ${added} new` : ""}\n`);

  const allPermissions = await prisma.permission.findMany({ select: { id: true, key: true } });
  const permissionId = new Map(allPermissions.map((p) => [p.key, p.id]));
  ROLE_DEFINITIONS["Super Admin"].keys = allPermissions.map((p) => p.key);

  /* --- roles ----------------------------------------------------------- */
  for (const [name, definition] of Object.entries(ROLE_DEFINITIONS)) {
    const role = await prisma.role.upsert({
      where: { name },
      update: { description: definition.description, hierarchyLevel: definition.hierarchyLevel },
      create: {
        name,
        description: definition.description,
        hierarchyLevel: definition.hierarchyLevel,
        isSystem: name === "Super Admin" || name === "Admin",
      },
    });

    const wanted = [...new Set(definition.keys)];
    const unknown = wanted.filter((k) => !permissionId.has(k));
    if (unknown.length > 0) {
      throw new Error(`${name} names permissions that do not exist: ${unknown.join(", ")}`);
    }

    // Set the role to EXACTLY this list, so removing a key here removes it
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: wanted.map((key) => ({ roleId: role.id, permissionId: permissionId.get(key)! })),
    });

    log(`${name.padEnd(22)} ${wanted.length} permissions`);
  }

  /* --- people ---------------------------------------------------------- */
  log("");
  const superAdmin = await prisma.user.findFirst({
    where: { email: "superadmin@straightdrivesport.com" },
    select: { id: true },
  });

  for (const person of PEOPLE.filter((p) => included(p.email))) {
    const role = await prisma.role.findUnique({ where: { name: person.primaryRole } });
    if (!role) throw new Error(`Role ${person.primaryRole} missing`);

    const department = person.department
      ? await prisma.department.findUnique({ where: { name: person.department } })
      : null;
    if (person.department && !department) {
      throw new Error(`Department ${person.department} missing`);
    }

    // Renaming keeps every record this person is attached to
    let user = await prisma.user.findUnique({ where: { email: person.email } });
    if (!user && person.renameFrom) {
      const old = await prisma.user.findUnique({ where: { email: person.renameFrom } });
      if (old) {
        user = await prisma.user.update({
          where: { id: old.id },
          data: { email: person.email, name: person.name },
        });
        log(`renamed ${person.renameFrom} → ${person.email} (${person.name})`);
      }
    }

    if (!user) {
      const starting = options.knownPasswords
        ? person.newPassword ?? DEFAULT_PASSWORD
        : `${randomBytes(9).toString("base64url")}#1Aa`; // meets the password rules
      user = await prisma.user.create({
        data: {
          name: person.name,
          email: person.email,
          password: await bcrypt.hash(starting, 12),
          roleId: role.id,
          departmentId: department?.id ?? null,
          isActive: true,
          // A starting password only: requireAuth() stops each person at
          // /settings/password until they have replaced it.
          mustChangePassword: true,
        },
      });
      log(`created ${person.name} <${person.email}> — starting password ${starting} (must be changed at first sign-in)`);
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          name: person.name,
          roleId: role.id,
          departmentId: department?.id ?? null,
          // isActive is left alone: an account someone switched off stays off
        },
      });
    }

    // Additional roles, set to exactly the list above
    const wantedExtra = person.additionalRoles ?? [];
    await prisma.userRole.deleteMany({
      where: { userId: user.id, role: { name: { notIn: wantedExtra } } },
    });
    for (const roleName of wantedExtra) {
      const extra = await prisma.role.findUnique({ where: { name: roleName } });
      if (!extra) throw new Error(`Role ${roleName} missing`);
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: extra.id } },
        update: {},
        create: {
          userId: user.id,
          roleId: extra.id,
          reason: `Also does the ${roleName.toLowerCase()} job`,
          grantedById: superAdmin?.id ?? null,
        },
      });
    }

    const held = [person.primaryRole, ...wantedExtra].join(" + ");
    log(`${person.name.padEnd(18)} ${held}${person.department ? ` · ${person.department}` : ""}`);
  }

  /* --- individual grants ------------------------------------------------ */
  // Each listed person ends up with exactly their listed grants. This used to
  // delete ALL of Kirubakaran's grants on every run (his old one-offs had become
  // roles), which would also have wiped any grant made since.
  log("");
  for (const grant of INDIVIDUAL_GRANTS.filter((g) => included(g.email))) {
    const person = await prisma.user.findUnique({ where: { email: grant.email }, select: { id: true, name: true } });
    if (!person) continue;
    const ids = grant.keys.map((key) => {
      const id = permissionId.get(key);
      if (!id) throw new Error(`Individual grant names a permission that does not exist: ${key}`);
      return id;
    });
    const removed = await prisma.userPermission.deleteMany({
      where: { userId: person.id, permissionId: { notIn: ids } },
    });
    for (const pid of ids) {
      await prisma.userPermission.upsert({
        where: { userId_permissionId: { userId: person.id, permissionId: pid } },
        update: { reason: grant.reason },
        create: {
          userId: person.id,
          permissionId: pid,
          reason: grant.reason,
          grantedById: superAdmin?.id ?? person.id,
        },
      });
    }
    log(`${person.name.padEnd(18)} individually: ${grant.keys.join(", ")}${removed.count ? ` (${removed.count} old grant${removed.count === 1 ? "" : "s"} removed)` : ""}`);
  }

  /* --- accounts no longer needed ---------------------------------------- */
  for (const email of DEACTIVATE.filter(included)) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user?.isActive) {
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      log(`deactivated ${email}`);
    }
  }

  /* --- retired roles ---------------------------------------------------- */
  log("");
  for (const name of RETIRED_ROLES) {
    const role = await prisma.role.findUnique({
      where: { name },
      include: { _count: { select: { users: true, heldAsAdditional: true } } },
    });
    if (!role) continue;
    const holders = role._count.users + role._count.heldAsAdditional;
    if (holders > 0) {
      log(`${name}: still held by ${holders} — left alone`);
    } else {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      log(`${name}: retired (no holders, permissions stripped)`);
    }
  }

  /* --- the stock approval flow ------------------------------------------ */
  //
  // A submitted entry needs a flow to follow, or it cannot be submitted at all.
  // The step names the role EXPECTED to approve; who is actually ALLOWED to is
  // decided by `stock.approve` plus the site the goods arrived at — see
  // approvalRefusal() in src/lib/actions/stock.ts. That separation is why the
  // step naming a role nobody held used to block every approval in the system.
  const approver = await prisma.role.findUnique({ where: { name: "Stock Manager" } });
  if (approver) {
    const repointed = await prisma.approvalFlowStep.updateMany({
      where: { approverRole: { name: { in: ["Central Stock Manager", "Stock Approver"] } } },
      data: { approverRoleId: approver.id, stepLabel: "Site stock approval" },
    });
    if (repointed.count > 0) {
      log(`\napproval flow: ${repointed.count} step(s) now point at Stock Manager`);
    }

    // A fresh database has no flow yet
    const existing = await prisma.approvalFlowConfig.findFirst({
      where: { isActive: true, departmentId: null },
    });
    if (!existing) {
      await prisma.approvalFlowConfig.create({
        data: {
          name: "Default Approval Flow",
          departmentId: null, // applies everywhere unless a department overrides it
          isActive: true,
          steps: {
            create: [
              { stepOrder: 1, stepLabel: "Site stock approval", approverRoleId: approver.id },
            ],
          },
        },
      });
      log("\napproval flow: created, one step — site stock approval");
    }
  }
}

/* --- running it on its own ------------------------------------------------ */

if (process.argv[1]?.includes("setup-roles-and-people")) {
  const client = new PrismaClient();
  applyRolesAndPeople(client)
    .catch((e) => {
      console.error("Failed:", e);
      process.exit(1);
    })
    .finally(() => client.$disconnect());
}
