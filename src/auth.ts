import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/auth.config";
import { loginSchema } from "@/lib/validations/auth";
import { AUTH_INCLUDE, unionPermissions, roleNames, strongestHierarchy, type AuthUser } from "@/lib/rbac/effective-user";
import { clearFailures, isThrottled, recordFailure } from "@/lib/login-throttle";

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
    mustChangePassword: user.mustChangePassword,
    // When the password was last set. A session carrying an older stamp ends
    // at its next refresh — so setting a new password signs out everywhere.
    credentialStamp: user.passwordSetAt?.getTime() ?? 0,
  };
}

/**
 * Compared against when the email is unknown, so a wrong email takes as long
 * to refuse as a wrong password and the form cannot be used to find out which
 * addresses have accounts. (A bcrypt hash of a random string, cost 12.)
 */
const NO_SUCH_USER_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO5A3v6ZbmmKjT.Ynx.RMnVzr2VJtN5Hu";

/** The caller's address, as the platform's proxy reports it. */
function addressOf(request: Request | undefined): string {
  const forwarded = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request?.headers.get("x-real-ip") || "unknown";
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
        token.mustChangePassword = user.mustChangePassword;
        token.credentialStamp = user.credentialStamp;
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
      // The session ends — within 30 seconds, whatever the cookie says — when
      // the account is gone or disabled, or its password was set again since
      // this session signed in (so a reset throws out whoever had it).
      if (
        !dbUser ||
        !dbUser.isActive ||
        dbUser.isSystem ||
        (dbUser.passwordSetAt?.getTime() ?? 0) !== ((token.credentialStamp as number | undefined) ?? 0)
      ) {
        return null;
      }
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
      token.mustChangePassword = shaped.mustChangePassword;
      token.refreshedAt = Date.now();
      return token;
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;
        const address = addressOf(request);

        // Refuse before comparing passwords, so a guessing run costs an
        // attacker time rather than costing us a bcrypt comparison each try.
        if (await isThrottled(email, address)) return null;

        const user = await prisma.user.findUnique({
          where: { email },
          include: AUTH_INCLUDE,
        });

        // The system account exists only to own deleted people's records, so
        // that their history stays searchable. It can never sign in.
        const usable = user && user.isActive && !user.isSystem;
        const isValid = await bcrypt.compare(password, usable ? user.password : NO_SUCH_USER_HASH);
        if (!usable || !isValid) {
          await recordFailure(email, address);
          return null;
        }

        await clearFailures(email, address);
        return toSessionUser(user);
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 hours
  },
});
