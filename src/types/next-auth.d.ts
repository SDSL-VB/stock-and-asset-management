import { DefaultSession } from "next-auth";

/**
 * The shape of `session.user` everywhere in the app.
 *
 * `permissions` is the union of every role held plus individual grants — it is
 * what every gate reads. `role` is the primary role's name, kept for the badge
 * and the directory filter; `roles` lists all of them, primary first. Neither
 * name should ever decide what someone is allowed to do.
 */

declare module "next-auth" {
  interface User {
    role: string;
    roles: string[];
    permissions: string[];
    departmentId?: string | null;
    /** Inherited from the user's department; null for users without one */
    locationId?: string | null;
    /** True when the user's department is their location's central stock */
    inCentralStock?: boolean;
    /** The strongest rank held. Lower is stronger. */
    hierarchyLevel: number;
    /** True until the person replaces a password an admin chose for them. */
    mustChangePassword?: boolean;
  }

  interface Session {
    user: {
      id: string;
      role: string;
      roles: string[];
      permissions: string[];
      departmentId?: string | null;
      locationId?: string | null;
      inCentralStock?: boolean;
      hierarchyLevel: number;
      mustChangePassword?: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    roles: string[];
    permissions: string[];
    departmentId?: string | null;
    locationId?: string | null;
    inCentralStock?: boolean;
    hierarchyLevel: number;
    mustChangePassword?: boolean;
  }
}
