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
 *   Jobs are not job titles. Buyer, Stock Approver and Builder are small roles
 *   that sit ON TOP of whatever else someone does, so Kiruba is one account
 *   holding four roles rather than a manager with a pile of exceptions.
 *
 *   Nothing is granted by role NAME in the application. These lists decide
 *   everything; the code only ever asks "do they hold this key?".
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

/** What a newly created account gets. Change it on first sign-in. */
export const DEFAULT_PASSWORD = "Welcome@123!";

/** Everyone can undo their own mistakes, and only their own. */
const OWN_RECYCLE_BIN = [
  "recyclebin.view",
  "recyclebin.restore",
  "recyclebin.scope.own",
];

const ROLE_DEFINITIONS: Record<string, { description: string; hierarchyLevel: number; keys: string[] }> = {
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
      "roles.view", "roles.create", "roles.edit", "roles.delete",
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
      // Assets: read only. Turning stock into a holding belongs to the people
      // who can see the stock it comes from.
      "assets.view",
      // Buying, end to end, including the rule about whether needs are verified
      "procurement.intent.view", "procurement.intent.create", "procurement.intent.approve",
      "procurement.po.view", "procurement.po.create", "procurement.po.close",
      "procurement.value.view", "config.flows.procurement",
      // History of the things they run — not goods movements, not passwords
      "activity.view", "activity.scope.all",
      "activity.view.people", "activity.view.catalog", "activity.view.procurement",
      // Settings and the bin
      "settings.view", "settings.edit",
      "recyclebin.view", "recyclebin.restore", "recyclebin.purge", "recyclebin.scope.all",
    ],
  },

  Auditor: {
    description:
      "Read-only oversight of every site including value, plus the catalog, the masters and the asset register.",
    hierarchyLevel: 2,
    keys: [
      // The reports nobody else gets
      "reports.view", "reports.export",
      "stock.view", "stock.scope.all", "stock.value.view", "stock.warranty.view",
      "dispatch.view", "dispatch.export",
      // Read
      "departments.view", "users.view", "bom.view", "products.view", "fulfilment.view",
      // Masters, including taking the list away as a file
      "vendors.view", "vendors.create", "vendors.edit", "vendors.export",
      "clients.view", "clients.create", "clients.edit", "clients.export",
      // Catalog: adding and correcting products and categories
      "products.create", "products.create.made", "products.edit",
      "categories.create", "categories.edit",
      "products.request.approve", "categories.request.approve",
      // Managing assets means being able to make one
      "assets.view", "assets.create", "stock.move",
      ...OWN_RECYCLE_BIN,
    ],
  },

  "Department Manager": {
    description:
      "Runs a department: its stock, its assets, its people's transfer requests and its bills of materials.",
    hierarchyLevel: 2,
    keys: [
      "users.view", "departments.view",
      // Their department's stock, plus their site's central stock to pull from
      "stock.view", "stock.scope.department", "stock.move", "stock.warranty.view",
      // Their team's transfers land here
      "assets.transfer.request", "assets.transfer.approve",
      "assets.view", "assets.create",
      // A manager publishes what their team writes. Building is NOT here: it
      // belongs to whoever runs production, which is one person, not every
      // holder of this role — see the Builder role below.
      "bom.view", "bom.create", "bom.edit", "bom.approve", "bom.publish",
      "fulfilment.view", "fulfilment.request",
      // They can state a need like anyone; verifying one is the Buyer's job
      "procurement.intent.view", "procurement.intent.create", "procurement.po.view",
      // Their department's history only
      "activity.view", "activity.scope.department",
      "activity.view.people", "activity.view.stock", "activity.view.movement",
      "activity.view.making",
      ...OWN_RECYCLE_BIN,
    ],
  },

  Engineer: {
    description:
      "Works in a department: finds stock, asks for it, states what is needed, and writes bills of materials.",
    hierarchyLevel: 4,
    keys: [
      // Their department's stock plus their site's central stock
      "stock.view", "stock.scope.department",
      "products.view",
      // Asking, never doing: every one of these is reviewed by someone else
      "assets.transfer.request",
      "products.request.create", "categories.request.create",
      // Seeing every site's availability is what makes asking another site possible
      "fulfilment.view", "fulfilment.request",
      "procurement.intent.view", "procurement.intent.create",
      "bom.view", "bom.create",
      "assets.view",
      ...OWN_RECYCLE_BIN,
    ],
  },

  "Stock Entry Operator": {
    description:
      "Books goods in: fresh stock or a delivery against an order, submitted for approval.",
    hierarchyLevel: 3,
    keys: [
      "stock.view", "stock.create", "stock.edit", "stock.scope.own",
      "stock.batch.edit", "stock.value.view",
      "stock.warranty.view", "stock.warranty.edit",
      "products.view",
      // Enough of procurement to tell a PO delivery from a fresh one
      "procurement.intent.view", "procurement.intent.create", "procurement.po.view",
      "products.request.create", "categories.request.create",
      "bom.view", "bom.create",
      ...OWN_RECYCLE_BIN,
    ],
  },

  "Dispatch Operator": {
    description:
      "Moves goods out: consignments to other sites and to clients, and answering other sites' requests.",
    hierarchyLevel: 3,
    keys: [
      "dispatch.view", "dispatch.create", "dispatch.accept", "dispatch.receive",
      "dispatch.export",
      // Their whole site's stock — you cannot dispatch what you cannot see
      "stock.view", "stock.scope.location", "stock.warranty.view",
      // Check readiness, ask another site, answer their asks
      "fulfilment.view", "fulfilment.request", "fulfilment.approve",
      "products.view", "bom.view",
      ...OWN_RECYCLE_BIN,
    ],
  },

  /* --- the two job-shaped roles, held on top of another ------------------ */

  Buyer: {
    description:
      "Held on top of another role. Verifies what is needed and turns it into orders.",
    hierarchyLevel: 2,
    keys: [
      "procurement.intent.view", "procurement.intent.create", "procurement.intent.approve",
      "procurement.po.view", "procurement.po.create", "procurement.po.close",
      "procurement.value.view",
      "vendors.view", "products.view",
      "activity.view", "activity.view.procurement",
    ],
  },

  "Stock Approver": {
    description:
      "Held on top of another role. Approves goods arriving at their own site.",
    hierarchyLevel: 2,
    keys: [
      "stock.approve", "stock.view", "stock.scope.location", "stock.warranty.view",
    ],
  },

  Builder: {
    description:
      "Held on top of another role. Runs builds: takes components out of central stock and books the finished product in.",
    hierarchyLevel: 2,
    keys: [
      // Building reads a bill of materials and draws down central stock, so it
      // needs sight of both. The whole site, because the components are held in
      // central stock rather than in the builder's own department.
      "bom.build", "bom.build.finish", "bom.unbuild",
      "bom.view", "stock.view", "stock.scope.location",
    ],
  },
};

/** No live holders once the engineers move across. Kept, not deleted: their
 *  names appear on historic approval records. */
const RETIRED_ROLES = ["Central Stock Manager", "Staff", "Production Engineer", "R&D Engineer"];

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
    primaryRole: "Auditor",
    additionalRoles: ["Buyer"],
    department: "Accounts",
    newPassword: "Audit@123!",
  },
  {
    email: "kiruba@straightdrivesport.com",
    name: "Kirubakaran",
    primaryRole: "Department Manager",
    // Runs Production, does the buying, approves goods at Bengaluru, and is the
    // only person other than the Super Admin who runs builds.
    additionalRoles: ["Buyer", "Stock Approver", "Builder"],
    department: "Production",
  },
  { email: "manu@straightdrivesport.com", name: "Manohar", primaryRole: "Department Manager", department: "R&D" },
  { email: "deepanjona@straightdrivesport.com", name: "Deepanjona", primaryRole: "Engineer", department: "Production" },
  { email: "raghava@straightdrivesport.com", name: "Raghava", primaryRole: "Engineer", department: "R&D" },
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

/** Somewhere to send progress. The seed indents it; the script prints plainly. */
type Options = { log?: (line: string) => void };

/**
 * Creates or updates every role and every person, and points the stock approval
 * flow at a role somebody actually holds.
 *
 * Takes the Prisma client as an argument so the seed can pass its own, rather
 * than two clients competing over the same rows.
 */
export async function applyRolesAndPeople(prisma: PrismaClient, options: Options = {}) {
  const log = options.log ?? ((line: string) => console.log(line));

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

  for (const person of PEOPLE) {
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
      user = await prisma.user.create({
        data: {
          name: person.name,
          email: person.email,
          password: await bcrypt.hash(person.newPassword ?? DEFAULT_PASSWORD, 12),
          roleId: role.id,
          departmentId: department?.id ?? null,
          isActive: true,
          // The password below is written down in this file, so it is a
          // starting password only: requireAuth() stops each person at
          // /settings/password until they have replaced it.
          mustChangePassword: true,
        },
      });
      log(`created ${person.name} <${person.email}> — starting password ${person.newPassword ?? DEFAULT_PASSWORD} (must be changed at first sign-in)`);
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          name: person.name,
          roleId: role.id,
          departmentId: department?.id ?? null,
          isActive: true,
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
  // Kiruba's four exceptions are now the Buyer and Stock Approver roles, so the
  // one-off grants would be duplicates nobody could explain later.
  const cleared = await prisma.userPermission.deleteMany({
    where: { user: { email: "kiruba@straightdrivesport.com" } },
  });
  if (cleared.count > 0) {
    log(`\n  removed ${cleared.count} individual grants from Kirubakaran — now covered by his roles`);
  }

  /* --- accounts no longer needed ---------------------------------------- */
  for (const email of DEACTIVATE) {
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
  const approver = await prisma.role.findUnique({ where: { name: "Stock Approver" } });
  if (approver) {
    const repointed = await prisma.approvalFlowStep.updateMany({
      where: { approverRole: { name: "Central Stock Manager" } },
      data: { approverRoleId: approver.id, stepLabel: "Site stock approval" },
    });
    if (repointed.count > 0) {
      log(`\napproval flow: ${repointed.count} step(s) now point at Stock Approver`);
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
