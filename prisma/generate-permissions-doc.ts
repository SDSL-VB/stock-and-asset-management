/**
 * Writes permissions.md from the live database.
 *
 * A hand-maintained list of who can do what goes stale the first time someone
 * changes a role in the UI. This reads the actual grants and rewrites the file,
 * so the document is always the truth rather than a memory of it.
 *
 * Run with: npx tsx prisma/generate-permissions-doc.ts
 */
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

/** Plain-English summary per module, so the file reads rather than decodes. */
const MODULE_LABELS: Record<string, string> = {
  users: "Team members",
  roles: "Roles & permissions",
  departments: "Departments",
  clients: "Clients",
  vendors: "Vendors",
  dispatch: "Dispatch",
  products: "Product catalog",
  stock: "Stock",
  reports: "Reports",
  activity: "Activity log",
  settings: "Settings",
  assets: "Assets",
  bom: "Bills of materials",
  config: "Configuration",
  recyclebin: "Recycle bin",
  fulfilment: "Fulfilment",
  procurement: "Procurement",
};

/** Everyone who holds a role: as their main one, or on top of another. */
function holders(role: { _count: { users: number; heldAsAdditional: number } }) {
  return role._count.users + role._count.heldAsAdditional;
}

function moduleLabel(m: string) {
  return MODULE_LABELS[m] ?? m;
}

/**
 * The questions people actually ask about a colleague's account, answered as
 * yes or no. Anything on this list is a capability someone has been surprised
 * by — either because they expected a button that is not there, or because they
 * did not expect the person to be able to do it at all.
 */
const HEADLINE_CAPABILITIES: { key: string; yes: string; no: string }[] = [
  { key: "stock.create", yes: "book goods in", no: "book goods in" },
  { key: "stock.approve", yes: "approve goods arriving", no: "approve goods arriving" },
  { key: "stock.move", yes: "move approved stock into a department", no: "move stock into a department" },
  { key: "stock.value.view", yes: "see what stock cost", no: "see what stock cost — quantities only, never prices" },
  { key: "dispatch.create", yes: "send stock out", no: "send stock out" },
  { key: "bom.build", yes: "run builds", no: "run builds" },
  { key: "procurement.po.create", yes: "place purchase orders", no: "place purchase orders" },
  { key: "users.create", yes: "add team members", no: "add team members" },
  { key: "roles.edit", yes: "change what any role may do", no: "change what any role may do" },
  { key: "reports.view", yes: "read the reports", no: "read the reports" },
  { key: "activity.view.security", yes: "read the security log", no: "read the security log" },
];

/** How much stock someone sees, said in a sentence rather than a key. */
function stockScopeSentence(keys: Set<string>, site: string | null): string {
  if (keys.has("stock.scope.all")) {
    return "Sees **every stock entry in the company**, at every site.";
  }
  if (keys.has("stock.scope.location")) {
    return `Sees **everything at ${site ?? "their own site"}** — every department there, plus that site's central stock.`;
  }
  if (keys.has("stock.scope.department")) {
    return "Sees **their own department's stock**, plus the central stock of their own site that is still worth acting on.";
  }
  if (keys.has("stock.scope.own")) {
    return "Sees **only the entries they created themselves**.";
  }
  return "Has no stock scope, so the stock list is empty even if they can open it.";
}

/** The same, for the activity log. */
function activityScopeSentence(keys: Set<string>): string {
  if (!keys.has("activity.view")) return "Cannot open the activity log at all.";
  if (keys.has("activity.scope.all")) return "On the activity log, sees **everyone's** actions.";
  if (keys.has("activity.scope.department")) {
    return "On the activity log, sees **their own department's** actions, and actions done to its members.";
  }
  return "On the activity log, sees **only their own** actions.";
}

async function main() {
  const allRoles = await prisma.role.findMany({
    include: {
      permissions: { include: { permission: true } },
      _count: { select: { users: true, heldAsAdditional: true } },
      users: { select: { name: true, email: true }, orderBy: { name: "asc" } },
    },
    orderBy: { hierarchyLevel: "asc" },
  });

  // A retired role — nobody holds it and it grants nothing — is kept in the
  // database because past approval records name it, but listing it here would
  // only invite someone to assign it again.
  const roles = allRoles.filter(
    (role) =>
      role.permissions.length > 0 ||
      role._count.users > 0 ||
      role._count.heldAsAdditional > 0
  );
  const retired = allRoles.length - roles.length;

  const allPermissions = await prisma.permission.findMany({
    orderBy: [{ module: "asc" }, { key: "asc" }],
  });

  // Real people, and what they can actually do. A role says what a job is
  // allowed to do; a person can hold several roles at once plus individual
  // grants, so this is the only place the real answer appears.
  const people = await prisma.user.findMany({
    where: { isSystem: false },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      additionalRoles: {
        include: { role: { include: { permissions: { include: { permission: true } } } } },
      },
      extraPermissions: { include: { permission: true } },
      department: { include: { location: { select: { name: true } } } },
    },
    orderBy: { name: "asc" },
  });

  const lines: string[] = [];

  // GitHub heading slugs: lowercase, strip punctuation, spaces to hyphens
  const slug = (h: string) =>
    h.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s/g, "-");

  lines.push("# Who can do what");
  lines.push("");
  lines.push(
    "Every capability in this system is its own permission, and a role is simply the set of permissions it holds. Nothing is gated on a role's *name* — change the permissions and the behaviour changes with them."
  );
  lines.push("");
  lines.push(
    "> **This file is generated.** Run `npx tsx prisma/generate-permissions-doc.ts` after changing any role, and it will be rewritten from the database. Editing it by hand will be overwritten."
  );
  lines.push("");
  lines.push(
    `_Last generated from the database. ${roles.length} roles, ${allPermissions.length} permissions${retired > 0 ? `, and ${retired} retired role${retired === 1 ? "" : "s"} not listed` : ""}._`
  );
  lines.push("");
  // ---- Contents ----
  //
  // Both halves of this file are long lists, so jumping straight to one role
  // or one module is the common way it gets read.
  lines.push("## Contents");
  lines.push("");
  lines.push(`- [The roles](#the-roles)`);
  for (const role of roles) {
    lines.push(`  - [${role.name}](#${slug(role.name)})`);
  }
  lines.push(`- [The people](#the-people)`);
  for (const person of people) {
    lines.push(`  - [${person.name}](#${slug(person.name)})`);
  }
  lines.push(`- [Every permission, and who holds it](#every-permission-and-who-holds-it)`);
  // Modules in the order they appear in the grid below
  const modulesInOrder = [...new Set(allPermissions.map((p) => p.module))];
  for (const moduleName of modulesInOrder) {
    const label = moduleLabel(moduleName);
    lines.push(`  - [${label}](#${slug(label)})`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  // ---- Per role, in plain language ----
  lines.push("## The roles");
  lines.push("");

  for (const role of roles) {
    const held = role.permissions.map((rp) => rp.permission);
    const byModule = new Map<string, string[]>();
    for (const p of held) {
      if (!byModule.has(p.module)) byModule.set(p.module, []);
      byModule.get(p.module)!.push(p.name);
    }

    lines.push(`### ${role.name}`);
    lines.push("");
    if (role.description) lines.push(`${role.description}`);
    lines.push("");
    lines.push(
      `**${held.length} permissions · ${holders(role)} ${holders(role) === 1 ? "person" : "people"}${role.isSystem ? " · protected system role" : ""}**`
    );
    lines.push("");

    if (role.users.length > 0) {
      lines.push(`Who: ${role.users.map((u) => u.name).join(", ")}`);
      lines.push("");
    }

    if (held.length === 0) {
      lines.push("_Holds no permissions — this role can sign in and see nothing._");
      lines.push("");
      continue;
    }

    for (const [mod, names] of [...byModule.entries()].sort()) {
      lines.push(`- **${moduleLabel(mod)}** — ${names.sort().join(", ")}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  // ---- Per person, in plain language ----
  //
  // Written for the question "what can Kirubakaran actually do?", which the
  // role list alone cannot answer: he holds four roles at once, and what he
  // can do is the sum of them.
  lines.push("## The people");
  lines.push("");
  lines.push(
    "What each person can do is the **sum** of every role they hold plus anything granted to them individually. Nothing is ever subtracted, so holding a second role can only widen what someone may do."
  );
  lines.push("");

  for (const person of people) {
    const keys = new Set<string>();
    for (const rp of person.role.permissions) keys.add(rp.permission.key);
    for (const held of person.additionalRoles) {
      for (const rp of held.role.permissions) keys.add(rp.permission.key);
    }
    const now = Date.now();
    for (const grant of person.extraPermissions) {
      if (grant.expiresAt && grant.expiresAt.getTime() <= now) continue;
      keys.add(grant.permission.key);
    }

    const roleNames = [person.role.name, ...person.additionalRoles.map((h) => h.role.name)];
    const site = person.department?.location?.name ?? null;
    const where = person.department
      ? `${person.department.name}${site ? `, ${site}` : ""}`
      : "no department — not narrowed by site";

    lines.push(`### ${person.name}`);
    lines.push("");
    lines.push(
      `\`${person.email}\` · ${roleNames.join(" + ")} · ${where}${person.isActive ? "" : " · **account deactivated**"}`
    );
    lines.push("");
    lines.push(`**${keys.size} permissions in total.**`);
    lines.push("");
    lines.push(stockScopeSentence(keys, site));
    lines.push("");
    lines.push(activityScopeSentence(keys));
    lines.push("");

    // The headline yes/no list — the questions people actually ask
    const can = HEADLINE_CAPABILITIES.filter((c) => keys.has(c.key)).map((c) => c.yes);
    const cannot = HEADLINE_CAPABILITIES.filter((c) => !keys.has(c.key)).map((c) => c.no);
    if (can.length > 0) lines.push(`- **Can:** ${can.join("; ")}.`);
    if (cannot.length > 0) lines.push(`- **Cannot:** ${cannot.join("; ")}.`);
    lines.push("");

    // Then the full holding, by area, so the summary above can be checked
    const byModule = new Map<string, string[]>();
    for (const perm of allPermissions) {
      if (!keys.has(perm.key)) continue;
      if (!byModule.has(perm.module)) byModule.set(perm.module, []);
      byModule.get(perm.module)!.push(perm.name);
    }
    lines.push("<details><summary>Everything they hold, by area</summary>");
    lines.push("");
    for (const [mod, names] of [...byModule.entries()].sort()) {
      lines.push(`- **${moduleLabel(mod)}** — ${names.sort().join(", ")}`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");

    // Individual grants are worth calling out: they are invisible in the role
    // list, so "why can she do that?" has no answer without them.
    const liveGrants = person.extraPermissions.filter(
      (g) => !g.expiresAt || g.expiresAt.getTime() > now
    );
    if (liveGrants.length > 0) {
      lines.push(
        `Granted individually, on top of their roles: ${liveGrants
          .map(
            (g) =>
              `${g.permission.name}${g.expiresAt ? ` (until ${g.expiresAt.toISOString().slice(0, 10)})` : ""}`
          )
          .join(", ")}.`
      );
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");

  // ---- The grid: which roles hold each permission ----
  lines.push("## Every permission, and who holds it");
  lines.push("");
  lines.push("The same information the other way round — useful when you want to know who could possibly have done something.");
  lines.push("");

  let currentModule = "";
  for (const perm of allPermissions) {
    if (perm.module !== currentModule) {
      currentModule = perm.module;
      lines.push("");
      lines.push(`### ${moduleLabel(currentModule)}`);
      lines.push("");
      lines.push("| Permission | Key | What it allows | Roles | People |");
      lines.push("|---|---|---|---|---|");
    }
    const heldBy = roles
      .filter((r) => r.permissions.some((rp) => rp.permission.key === perm.key))
      .map((r) => r.name);
    // Who really holds it, which is not the same list: one person can hold
    // several roles, and a role with no members grants nobody anything.
    const heldByPeople = people
      .filter((person) => {
        if (person.role.permissions.some((rp) => rp.permission.key === perm.key)) return true;
        if (
          person.additionalRoles.some((h) =>
            h.role.permissions.some((rp) => rp.permission.key === perm.key)
          )
        )
          return true;
        return person.extraPermissions.some((g) => g.permission.key === perm.key);
      })
      .map((person) => (person.isActive ? person.name : `${person.name} (inactive)`));
    lines.push(
      `| ${perm.name} | \`${perm.key}\` | ${perm.description ?? "—"} | ${heldBy.length > 0 ? heldBy.join(", ") : "_no role_"} | ${heldByPeople.length > 0 ? heldByPeople.join(", ") : "**nobody**"} |`
    );
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Rules that hold everywhere");
  lines.push("");
  lines.push("- **No permission, no button.** A capability someone lacks is not rendered at all — never greyed out, never failing on click.");
  lines.push("- **Location narrows, it never grants.** A person's site comes from their department. Someone with no department (Super Admin, Admin) is not restricted by location.");
  lines.push("- **Money is separate.** `stock.value.view` gates every price and total. A role can see all the stock in the company and none of its value.");
  lines.push("- **Scope is a permission too.** `stock.scope.all` / `.location` / `.department` / `.own` decide how much a role sees; the widest one held wins.");
  lines.push("- **A permission nobody holds is a job nobody can do.** Read the *People* column above: where it says **nobody**, that step of the flow has no owner and whatever needs it will sit and wait. The same applies per site — someone has to hold the permission *and* be posted where the work is.");
  lines.push("");
  lines.push("Tested by `docs/test-cases-permissions.md`, which walks every key in this file through the screen it governs.");
  lines.push("");

  const out = path.join(process.cwd(), "permissions.md");
  fs.writeFileSync(out, lines.join("\n"));
  console.log(`Wrote ${out}`);
  console.log(`  ${roles.length} roles, ${allPermissions.length} permissions`);
}

main()
  .catch((e) => {
    console.error("Could not generate permissions.md:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
