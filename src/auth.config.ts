import type { NextAuthConfig } from "next-auth";

/**
 * The half of the NextAuth config that must run on the Edge.
 *
 * `middleware.ts` builds a NextAuth instance from this file alone, so nothing
 * here may import Prisma or anything Node-only. The credentials provider and
 * the database-reading `jwt` callback live in `src/auth.ts`, which spreads this
 * object and adds them — meaning any callback defined here that is also defined
 * there is overridden and never runs.
 *
 * What this file is really for is shaping the SESSION from the token. Every
 * permission check in the app reads `session.user.permissions`, so this mapping
 * is what makes authorization work at all.
 */
export const authConfig = {
  pages: {
    signIn: "/login",
  },

  // In development only, this app's session cookie gets its own name.
  //
  // Every Auth.js app calls its cookie `authjs.session-token`, and cookies are
  // shared by everything on localhost regardless of port. Running another
  // Auth.js project on this machine meant each app kept finding the other's
  // cookie, failing to decrypt it ("no matching decryption secret") and
  // treating you as signed out. Only the name is set: Auth.js merges this over
  // its own defaults, so the security options are unchanged. Production is left
  // alone — there each app has its own domain, and Auth.js adds its __Secure-
  // prefix, which a fixed name here would drop.
  ...(process.env.NODE_ENV === "development"
    ? { cookies: { sessionToken: { name: "sdsim.session-token" } } }
    : {}),
  callbacks: {
    /**
     * Sends a signed-in person away from the login page.
     *
     * That redirect is the whole job. Route protection is NOT done here — it is
     * `middleware.ts`, which owns the route-to-permission map and is the only
     * place that knows every route.
     *
     * Worth knowing why, because this callback looks like the natural home for
     * it. NextAuth runs `authorized` first and then, only if it returned a plain
     * boolean, runs our middleware (`next-auth/lib/index.js`, `handleAuth`). So
     * returning `false` here does not block anything: middleware runs anyway and
     * issues its own redirect. Returning a `Response`, as below, DOES win and
     * skips middleware entirely.
     *
     * This used to also list eight dashboard prefixes and return `false` for a
     * signed-out visitor. Eleven routes had been added since without being added
     * to the list, and none of it had any effect for the reason above — a list
     * that looked load-bearing, was not, and invited someone to "fix" it.
     */
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;

      if (nextUrl.pathname === "/login" && isLoggedIn) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }

      return true;
    },

    /**
     * Token to session. Runs on every request that asks who the user is.
     *
     * The token is written by the `jwt` callback in `src/auth.ts`, which re-reads
     * the database at most every 30 seconds; this callback only copies. Anything
     * added to the token has to be copied here too, or it will not reach
     * `session.user` and nothing in the app will see it.
     */
    session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.name = token.name as string;
        session.user.email = token.email as string;
        session.user.role = token.role as string;
        session.user.roles = (token.roles as string[]) ?? [token.role as string];
        session.user.permissions = token.permissions as string[];
        session.user.departmentId = token.departmentId as string | undefined;
        session.user.locationId = (token.locationId as string | null) ?? null;
        session.user.inCentralStock = (token.inCentralStock as boolean) ?? false;
        session.user.hierarchyLevel = (token.hierarchyLevel as number) ?? 99;
        // Read by requireAuth() in src/lib/rbac/check.ts as the cheap path: a
        // session saying `false` is believed, and only a `true` costs a database
        // query to confirm. Middleware deliberately does NOT read it — see the
        // note at the top of middleware.ts for why a stale `true` was harmful.
        session.user.mustChangePassword = token.mustChangePassword === true;
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
