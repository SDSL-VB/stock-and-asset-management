import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = nextUrl.pathname.startsWith("/dashboard") ||
        nextUrl.pathname.startsWith("/users") ||
        nextUrl.pathname.startsWith("/roles") ||
        nextUrl.pathname.startsWith("/departments") ||
        nextUrl.pathname.startsWith("/activity") ||
        nextUrl.pathname.startsWith("/settings") ||
        nextUrl.pathname.startsWith("/stock") ||
        nextUrl.pathname.startsWith("/reports");
      const isOnLogin = nextUrl.pathname === "/login";

      if (isOnDashboard) {
        if (isLoggedIn) return true;
        return false; // Redirect to login
      }

      if (isOnLogin && isLoggedIn) {
        return Response.redirect(new URL("/dashboard", nextUrl));
      }

      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.roles = user.roles;
        token.permissions = user.permissions;
        token.departmentId = user.departmentId;
        token.locationId = user.locationId;
        token.inCentralStock = user.inCentralStock;
        token.hierarchyLevel = user.hierarchyLevel;
      }
      return token;
    },
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
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
