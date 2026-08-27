/**
 * Finds pages that let a role in and then bounce them straight back out.
 *
 * A failed `requirePermission` **redirects**. So a page whose own gate a role
 * passes can still throw them to /unauthorized because of one server action it
 * calls — an action gated on something else entirely. The symptom is always the
 * same, "Access Denied on a page I should be able to open", and the cause is
 * always invisible from the page itself.
 *
 * This walks it statically:
 *
 *   1. read middleware.ts for which permissions open each route
 *   2. read each page.tsx for the actions it imports and calls
 *   3. read each action for what it requires
 *   4. read the roles out of the database — so a role added next month is
 *      checked automatically, with no list here to keep up to date
 *
 * A call guarded by a conditional (`canX ? getY() : []`) is fine and is
 * reported separately as "guarded", because static reading cannot prove intent.
 * Everything under UNGUARDED is a real bounce.
 *
 * Run with: npx tsx prisma/audit-page-access.ts
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const prisma = new PrismaClient();
const ROOT = process.cwd();
const APP = join(ROOT, "src", "app", "(dashboard)");
const ACTIONS = join(ROOT, "src", "lib", "actions");

/** route → the permissions that open it, from middleware.ts */
function readRouteGates(): Map<string, string[]> {
  const src = readFileSync(join(ROOT, "middleware.ts"), "utf8");
  const block = /const ROUTE_PERMISSIONS[\s\S]*?\n\};/.exec(src)?.[0] ?? "";
  const gates = new Map<string, string[]>();

  for (const m of block.matchAll(/"([^"]+)":\s*\[([\s\S]*?)\]/g)) {
    const keys = [...m[2].matchAll(/"([^"]+)"/g)].map((k) => k[1]);
    gates.set(m[1], keys);
  }
  return gates;
}

/** action name → the permissions it demands */
function readActionGates(): Map<string, { any: string[]; all: string[] }> {
  const out = new Map<string, { any: string[]; all: string[] }>();

  for (const file of readdirSync(ACTIONS).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(ACTIONS, file), "utf8");

    // Split on exported functions so each gate lands with its own function
    const parts = src.split(/export async function /).slice(1);
    for (const part of parts) {
      const name = /^([A-Za-z0-9_]+)/.exec(part)?.[1];
      if (!name) continue;

      // Only the gates before the first blank-line-separated body chunk matter,
      // but taking the whole function is close enough and never under-reports
      const any: string[] = [];
      const all: string[] = [];

      for (const g of part.matchAll(/requirePermission\(\s*([^)]+?)\s*\)/g)) {
        all.push(...resolveKeys(g[1], src));
      }
      for (const g of part.matchAll(/requireAnyPermission\(\s*([\s\S]*?)\s*\)\s*;/g)) {
        any.push(...resolveKeys(g[1], src));
      }
      out.set(name, { any, all });
    }
  }
  return out;
}

/** Turns PERMISSIONS.X / "a.b" / GROUP constants into permission keys. */
function resolveKeys(expr: string, src: string): string[] {
  const keys: string[] = [];

  for (const m of expr.matchAll(/"([a-z][a-z0-9.]*\.[a-z0-9.]+)"/g)) keys.push(m[1]);
  for (const m of expr.matchAll(/PERMISSIONS\.([A-Z0-9_]+)/g)) {
    const key = PERMISSION_BY_CONST.get(m[1]);
    if (key) keys.push(key);
  }
  for (const m of expr.matchAll(/\b([A-Z][A-Z0-9_]*_PERMISSIONS)\b/g)) {
    keys.push(...(GROUPS.get(m[1]) ?? []));
  }
  return keys;
}

// PERMISSIONS.FOO → "foo.bar", and the exported groups
const PERMISSION_BY_CONST = new Map<string, string>();
const GROUPS = new Map<string, string[]>();

function readPermissionRegistry() {
  const src = readFileSync(join(ROOT, "src", "lib", "rbac", "permissions.ts"), "utf8");

  for (const m of src.matchAll(/^\s{2}([A-Z0-9_]+):\s*"([^"]+)",/gm)) {
    PERMISSION_BY_CONST.set(m[1], m[2]);
  }
  for (const m of src.matchAll(
    /export const ([A-Z][A-Z0-9_]*_PERMISSIONS): PermissionKey\[\] = \[([\s\S]*?)\];/g
  )) {
    const keys = [...m[2].matchAll(/PERMISSIONS\.([A-Z0-9_]+)/g)]
      .map((k) => PERMISSION_BY_CONST.get(k[1]))
      .filter((k): k is string => !!k);
    GROUPS.set(m[1], keys);
  }
}

type PageCall = { action: string; guarded: boolean };

/** Every action a page calls, and whether the call sits behind a condition. */
function readPageCalls(file: string): PageCall[] {
  const src = readFileSync(file, "utf8");
  const imported = new Set<string>();

  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*"@\/lib\/actions\/[^"]+"/g)) {
    for (const name of m[1].split(",")) {
      const clean = name.trim().split(/\s+as\s+/)[0].trim();
      if (clean) imported.add(clean);
    }
  }

  const calls: PageCall[] = [];
  for (const action of imported) {
    const callRe = new RegExp(`(\\S[^\\n]{0,80})\\b${action}\\s*\\(`, "g");
    let guardedEverywhere = true;
    let seen = false;

    for (const m of src.matchAll(callRe)) {
      seen = true;
      // `cond ? getX() : []`, `cond && getX()`, and the same with an `await`
      // in between, are all deliberate — the call only happens when the caller
      // has already established the permission holds.
      const guarded = /[?&|]\s*(await\s+)?$/.test(m[1]);
      if (!guarded) guardedEverywhere = false;
    }
    if (seen) calls.push({ action, guarded: guardedEverywhere });
  }
  return calls;
}

/** Client components, where most permission-gated controls actually live. */
function findComponents(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findComponents(full, out);
    else if (entry.endsWith(".tsx") && entry !== "page.tsx") out.push(full);
  }
  return out;
}

function findPages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findPages(full, out);
    else if (entry === "page.tsx") out.push(full);
  }
  return out;
}

/** Which route gate governs a page — the most specific prefix match. */
function routeFor(pageFile: string): string {
  const rel = relative(APP, pageFile).replace(/\\/g, "/").replace(/\/page\.tsx$/, "");
  return "/" + rel.replace(/\[[^\]]+\]/g, "").replace(/\/+$/, "").replace(/\/\//g, "/");
}

async function main() {
  readPermissionRegistry();
  const routeGates = readRouteGates();
  const actionGates = readActionGates();
  const pages = findPages(APP);

  const roles = await prisma.role.findMany({
    include: { permissions: { include: { permission: true } } },
    orderBy: { hierarchyLevel: "asc" },
  });

  console.log(
    `Auditing ${pages.length} pages against ${roles.length} roles (${PERMISSION_BY_CONST.size} permissions)\n`
  );

  const problems: string[] = [];
  const guardedNotes: string[] = [];

  for (const page of pages) {
    const route = routeFor(page);
    const gateEntry = [...routeGates.entries()]
      .filter(([r]) => route.startsWith(r))
      .sort(([a], [b]) => b.length - a.length)[0];
    const gate = gateEntry?.[1];
    const calls = readPageCalls(page);
    if (calls.length === 0) continue;

    for (const role of roles) {
      const held = new Set(role.permissions.map((rp) => rp.permission.key));

      // Can this role open the page at all?
      const opens = gate ? gate.some((k) => held.has(k)) : true;
      if (!opens) continue;

      for (const call of calls) {
        const need = actionGates.get(call.action);
        if (!need) continue;

        const failsAll = need.all.filter((k) => !held.has(k));
        const failsAny = need.any.length > 0 && !need.any.some((k) => held.has(k));
        if (failsAll.length === 0 && !failsAny) continue;

        const reason = failsAny
          ? `needs any of [${need.any.join(", ")}]`
          : `needs ${failsAll.join(", ")}`;
        const line = `  ${route.padEnd(22)} ${role.name.padEnd(22)} ${call.action}() ${reason}`;

        if (call.guarded) guardedNotes.push(line);
        else problems.push(line);
      }
    }
  }

  // ---------------------------------------------------------------- part two
  //
  // A page can also let a role in, load fine, and then hide the very button the
  // grant was meant to give them — because the control is gated on a *second*
  // permission from somewhere else. That is not a bounce, so the check above
  // cannot see it. It has caused three bugs so far, all the same shape.
  const compound: string[] = [];
  for (const page of [...pages, ...findComponents(APP)]) {
    const src = readFileSync(page, "utf8");
    const rel = relative(ROOT, page).replace(/\\/g, "/");

    // A whole gate expression, however it is parenthesised: a run of has(...)
    // calls joined by && / || . `(has(A) || has(B)) && has(C)` is the shape that
    // hid the New bill of materials button, and an adjacent-pair regex misses it.
    for (const m of src.matchAll(
      /(?:has\(\s*PERMISSIONS\.[A-Z0-9_]+\s*\)|[()\s]|&&|\|\|){2,}/g
    )) {
      const expr = m[0];
      if (!expr.includes("&&")) continue;

      const keys = [...expr.matchAll(/PERMISSIONS\.([A-Z0-9_]+)/g)]
        .map((k) => PERMISSION_BY_CONST.get(k[1]))
        .filter((k): k is string => !!k);
      if (keys.length < 2) continue;

      const modules = new Set(keys.map((k) => k.split(".")[0]));
      // Two keys from one module are usually a deliberate pair; two modules
      // means one grant is silently conditional on another area entirely.
      if (modules.size < 2) continue;

      compound.push(`  ${rel}\n      ${[...new Set(keys)].join(" + ")}`);
    }
  }

  if (compound.length > 0) {
    console.log(
      `Controls behind two permissions from different modules (${compound.length}) — each one hides a capability from someone who was granted it, so check the second is really required:`
    );
    console.log([...new Set(compound)].join("\n"));
    console.log("");
  }

  if (problems.length === 0) {
    console.log("UNGUARDED: none — every role that can open a page can load it.\n");
  } else {
    console.log(`UNGUARDED — these bounce to /unauthorized (${problems.length}):`);
    console.log([...new Set(problems)].join("\n"));
    console.log("");
  }

  const guarded = [...new Set(guardedNotes)];
  if (guarded.length > 0) {
    console.log(`Guarded by a condition, so fine (${guarded.length}) — spot-check if unsure:`);
    console.log(guarded.slice(0, 25).join("\n"));
    if (guarded.length > 25) console.log(`  …and ${guarded.length - 25} more`);
  }

  process.exitCode = problems.length > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error("Audit failed:", e);
    process.exit(2);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
