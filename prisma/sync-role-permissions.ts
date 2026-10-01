import { PrismaClient } from "@prisma/client";
import { ROLE_DEFINITIONS } from "./setup-roles-and-people";
import { PERMISSION_CATALOG } from "./lib/permission-catalog";

/**
 * Bring each role's permissions on a LIVE database into line with
 * ROLE_DEFINITIONS — and touch nothing else.
 *
 *   npx tsx --env-file=.env prisma/sync-role-permissions.ts           dry run
 *   npx tsx --env-file=.env prisma/sync-role-permissions.ts --apply   write
 *
 * Why not just run setup-roles-and-people.ts: that one also sets every listed
 * person's role, department and individual grants back to what the file says,
 * which undoes anything changed through the app since. This only changes which
 * permissions each ROLE carries (and creates a role the list has that the
 * database does not). People, their grants and their passwords are untouched.
 *
 * Permission keys new to the catalog are created first, and Super Admin — who
 * holds every key by design — is given any it lacks. Nothing is taken from
 * Super Admin here; the full setup script maintains it otherwise.
 *
 * A dry run prints, per role, exactly which keys would be added and removed,
 * and who holds that role — so the effect on real people is visible before
 * anything is written.
 */
const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgresql://unset").host;
  console.log(`Database: ${host}`);
  console.log(apply ? "Mode: APPLY" : "Mode: dry run (nothing will change)");

  // Keys the catalog has and the database does not — created, never removed
  const existing = new Set((await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key));
  const newKeys = PERMISSION_CATALOG.filter((p) => !existing.has(p.key));
  let changes = 0;
  if (newKeys.length) {
    changes++;
    console.log(`
New permissions: ${newKeys.map((p) => p.key).join(", ")}`);
    if (apply) await prisma.permission.createMany({ data: newKeys, skipDuplicates: true });
  }

  const permissions = await prisma.permission.findMany({ select: { id: true, key: true } });
  const idOf = new Map(permissions.map((p) => [p.key, p.id]));
  // In a dry run the new keys do not exist yet; a placeholder lets the roles
  // that use them be shown rather than skipped
  if (!apply) for (const p of newKeys) idOf.set(p.key, `(new) ${p.key}`);

  // Super Admin holds everything
  const superAdmin = await prisma.role.findUnique({
    where: { name: "Super Admin" },
    include: { permissions: { select: { permission: { select: { key: true } } } } },
  });
  if (superAdmin) {
    const held = new Set(superAdmin.permissions.map((p) => p.permission.key));
    const missing = PERMISSION_CATALOG.map((p) => p.key).filter((k) => !held.has(k));
    if (missing.length) {
      changes++;
      console.log(`
Super Admin`);
      for (const k of missing) console.log(`   + ${k}`);
      if (apply) {
        await prisma.rolePermission.createMany({
          data: missing.map((k) => ({ roleId: superAdmin.id, permissionId: idOf.get(k)! })),
          skipDuplicates: true,
        });
      }
    }
  }

  for (const [name, def] of Object.entries(ROLE_DEFINITIONS)) {
    if (name === "Super Admin") continue;

    const unknown = def.keys.filter((k) => !idOf.has(k));
    if (unknown.length) {
      console.log(`\n${name}: SKIPPED — the database has no permission ${unknown.join(", ")}. Run the full setup once to add it.`);
      continue;
    }

    const role = await prisma.role.findUnique({
      where: { name },
      include: {
        permissions: { select: { permission: { select: { key: true } } } },
        users: { select: { name: true } },
        heldAsAdditional: { select: { user: { select: { name: true } } } },
      },
    });

    const want = new Set(def.keys);
    const have = new Set(role?.permissions.map((p) => p.permission.key) ?? []);
    const add = [...want].filter((k) => !have.has(k)).sort();
    const remove = [...have].filter((k) => !want.has(k)).sort();
    if (role && add.length === 0 && remove.length === 0) continue;

    changes++;
    const holders = [
      ...(role?.users.map((u) => u.name) ?? []),
      ...(role?.heldAsAdditional.map((r) => `${r.user.name} (additional)`) ?? []),
    ];
    console.log(`\n${name}${role ? "" : "  — NEW ROLE"}   held by: ${holders.join(", ") || "nobody"}`);
    for (const k of add) console.log(`   + ${k}`);
    for (const k of remove) console.log(`   - ${k}`);

    if (!apply) continue;

    const saved = await prisma.role.upsert({
      where: { name },
      update: { description: def.description, hierarchyLevel: def.hierarchyLevel },
      create: { name, description: def.description, hierarchyLevel: def.hierarchyLevel },
    });
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({
        where: { roleId: saved.id, permission: { key: { in: remove } } },
      }),
      prisma.rolePermission.createMany({
        data: add.map((k) => ({ roleId: saved.id, permissionId: idOf.get(k)! })),
        skipDuplicates: true,
      }),
    ]);
  }

  if (changes === 0) console.log("\nEvery role already matches ROLE_DEFINITIONS.");
  else if (!apply) console.log(`\n${changes} role(s) would change. Dry run only — add --apply to write.`);
  else console.log(`\n${changes} role(s) updated. People sign in again within 30 seconds to pick it up.`);
}

main()
  .catch((e) => {
    console.error("Failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
