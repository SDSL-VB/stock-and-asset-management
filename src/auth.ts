import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/auth.config";
import { loginSchema } from "@/lib/validations/auth";

/**
 * Sign-in, and the one place a person's capabilities are worked out.
 *
 * Called by: NextAuth itself (the credentials provider on sign-in, the jwt
 * callback on every request). Nothing else should read roles from the database
 * to answer "may they?" — read `session.user.permissions` instead.
 *
 * Owns the rule that a person is the SUM of what they hold: every role they
 * have, plus anything granted to them individually.
 */

/** Everything needed to work out what one person may do. */
const AUTH_INCLUDE = {
  role: { include: { permissions: { include: { permission: { select: { key: true } } } } } },
  // Roles held on top of the primary one — see the UserRole model
  additionalRoles: {
    include: {
      role: {
        select: {
          name: true,
          hierarchyLevel: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
  },
  department: { select: { locationId: true, isCentralStock: true } },
  extraPermissions: {
    select: { expiresAt: true, permission: { select: { key: true } } },
  },
} as const;

type AuthUser = {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  departmentId: string | null;
  role: { name: string; hierarchyLevel: number; permissions: { permission: { key: string } }[] };
  additionalRoles: {
    role: { name: string; hierarchyLevel: number; permissions: { permission: { key: string } }[] };
  }[];
  department: { locationId: string | null; isCentralStock: boolean } | null;
  extraPermissions: { expiresAt: Date | null; permission: { key: string } }[];
};

/**
 * What a person can do: every permission from every role they hold, plus
 * anything granted to them individually.
 *
 * Grants are add-only, so this is a union and never a subtraction — which is
 * what makes "why can't she do this?" always answerable from her roles. An
 * expired grant simply drops out here, so expiry needs nothing on a schedule.
 */
function unionPermissions(user: AuthUser): string[] {
  const keys = new Set<string>();

  for (const rp of user.role.permissions) keys.add(rp.permission.key);
  for (const held of user.additionalRoles) {
    for (const rp of held.role.permissions) keys.add(rp.permission.key);
  }

  const now = Date.now();
  for (const grant of user.extraPermissions) {
    if (grant.expiresAt && grant.expiresAt.getTime() <= now) continue;
    keys.add(grant.permission.key);
  }

  return [...keys];
}

/** Every role name held, primary first — for the badge and the directory. */
function roleNames(user: AuthUser): string[] {
  return [user.role.name, ...user.additionalRoles.map((h) => h.role.name)];
}

/**
 * The strongest rank held. Lower is stronger, so holding a second role can
 * promote someone but never demote them.
 */
function strongestHierarchy(user: AuthUser): number {
  return user.additionalRoles.reduce(
    (best, held) => Math.min(best, held.role.hierarchyLevel),
    user.role.hierarchyLevel
  );
}

/** The session shape, built from a freshly-read user row. */
function toSessionUser(user: AuthUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.avatar,
    role: user.role.name,
    roles: roleNames(user),
    permissions: unionPermissions(user),
    departmentId: user.departmentId,
    // A person's site is inherited from their department; null for admins,
    // which is what leaves them unrestricted by location.
    locationId: user.department?.locationId ?? null,
    inCentralStock: user.department?.isCentralStock ?? false,
    hierarchyLevel: strongestHierarchy(user),
  };
}

/* -------------------------------------------------------------------------
   Slowing down password guessing.

   Held in memory, keyed by email address. That is a deliberate, limited
   choice: it costs nothing, needs no table, and stops the obvious attack —
   one account hammered with a wordlist. What it does NOT stop is somebody
   spreading their guesses across many addresses, and it resets when the
   process restarts. If this system ever faces the open internet rather than a
   test instance behind a proxy, move the counter into the database or put a
   real limiter in front of the app.
   ------------------------------------------------------------------------- */

const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

const failures = new Map<string, { count: number; firstAt: number }>();

function isLockedOut(email: string): boolean {
  const record = failures.get(email);
  if (!record) return false;

  // The window is measured from the first failure, so a burst of eight wrong
  // guesses buys fifteen minutes rather than a rolling extension.
  if (Date.now() - record.firstAt > LOCKOUT_MS) {
    failures.delete(email);
    return false;
  }

  return record.count >= MAX_ATTEMPTS;
}

function recordFailure(email: string): void {
  const record = failures.get(email);
  if (!record || Date.now() - record.firstAt > LOCKOUT_MS) {
    failures.set(email, { count: 1, firstAt: Date.now() });
    return;
  }
  record.count += 1;
}

function clearFailures(email: string): void {
  failures.delete(email);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        // Initial sign-in: the provider below already shaped everything
        token.id = user.id as string;
        token.role = user.role;
        token.roles = user.roles;
        token.permissions = user.permissions;
        token.departmentId = user.departmentId;
        token.locationId = user.locationId;
        token.inCentralStock = user.inCentralStock;
        token.hierarchyLevel = user.hierarchyLevel;
        token.refreshedAt = Date.now();
        return token;
      }

      // Later requests: re-read from the database every 30 seconds, so a
      // permission change lands without anyone signing out.
      if (!token.id) return token;
      const refreshedAt = (token.refreshedAt as number) ?? 0;
      if (Date.now() - refreshedAt <= 30_000) return token;

      const dbUser = await prisma.user.findUnique({
        where: { id: token.id as string },
        include: AUTH_INCLUDE,
      });
      if (dbUser) {
        const shaped = toSessionUser(dbUser);
        token.name = shaped.name;
        token.email = shaped.email;
        token.role = shaped.role;
        token.roles = shaped.roles;
        token.permissions = shaped.permissions;
        token.departmentId = shaped.departmentId;
        token.locationId = shaped.locationId;
        token.inCentralStock = shaped.inCentralStock;
        token.hierarchyLevel = shaped.hierarchyLevel;
        token.refreshedAt = Date.now();
      }
      return token;
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        // Refuse before touching the database, so a guessing run costs an
        // attacker time rather than costing us a bcrypt comparison each try.
        if (isLockedOut(email)) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          include: AUTH_INCLUDE,
        });

        // The system account exists only to own deleted people's records, so
        // that their history stays searchable. It can never sign in.
        if (!user || !user.isActive || user.isSystem) {
          recordFailure(email);
          return null;
        }

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
          recordFailure(email);
          return null;
        }

        clearFailures(email);
        return toSessionUser(user);
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
});
