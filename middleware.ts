import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

// Route → required permissions mapping
const ROUTE_PERMISSIONS: Record<string, string[]> = {
  "/users": ["users.view"],
  "/roles": ["roles.view"],
  "/departments": ["departments.view"],
  "/clients": ["clients.view", "clients.create", "clients.edit"],
  "/vendors": ["vendors.view", "vendors.create", "vendors.edit"],
  // Wider than assets.view: the transfer queue lives on this page too.
  // Keep in step with ASSET_PAGE_PERMISSIONS.
  "/assets": ["assets.view", "assets.transfer.request", "assets.transfer.approve"],
  // Keep in step with DISPATCH_PERMISSIONS, which is what the page accepts —
  // dispatch.export was missing here, so an export-only holder would see the
  // sidebar item and be bounced by the route.
  "/dispatch": [
    "dispatch.view",
    "dispatch.create",
    "dispatch.accept",
    "dispatch.receive",
    "dispatch.export",
  ],
  "/activity": ["activity.view"],
  "/settings": ["settings.view"],
  // Changing your own password is not a capability an admin can withhold, so it
  // is gated on nothing beyond being signed in. It must also stay reachable
  // while mustChangePassword is set, or the redirect below would loop.
  "/settings/password": [],
  // Your own profile is not a setting. It sits under /settings only by URL, and
  // the longest-prefix rule below would otherwise hand it to the line above —
  // which sent everyone without settings.view to /unauthorized from a link
  // their own sidebar showed them. An empty list means "signed in is enough",
  // matching the page's own requireAuth() gate.
  "/settings/profile": [],
  "/configure": [
    "stock.config.fields",
    "stock.config.attachments",
    "stock.config.flows",
    "config.flows.bom",
    "config.flows.procurement",
  ],
  // Must list exactly what the page accepts. Keep in step with
  // CATALOG_PAGE_PERMISSIONS — a key here that the page does not accept locks
  // someone out of a page they could use, and the reverse hides one they can.
  "/stock/products": [
    "products.create",
    "products.create.made",
    "products.edit",
    "categories.create",
    "categories.edit",
    "categories.prefix.edit",
    "products.request.create",
    "products.request.approve",
    "categories.request.create",
    "categories.request.approve",
  ],
  "/stock": ["stock.view", "stock.create"],
  "/bom": ["bom.view", "bom.create", "bom.edit", "bom.approve", "bom.publish", "bom.build"],
  "/builds": ["bom.view", "bom.build", "bom.unbuild"],
  "/recycle-bin": ["recyclebin.view", "recyclebin.restore", "recyclebin.purge"],
  "/reports": ["reports.view"],
  "/fulfilment": ["fulfilment.view", "fulfilment.request", "fulfilment.approve"],
  "/procurement": [
    "procurement.intent.view",
    "procurement.intent.create",
    "procurement.intent.approve",
    "procurement.po.view",
    "procurement.po.create",
    "procurement.po.close",
  ],
};

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user;

  // Someone whose password was chosen for them by an admin goes nowhere else
  // until they have replaced it. This runs before the permission check below so
  // that it applies to every page, not only the ones with a permission mapping.
  if (user?.mustChangePassword && pathname !== "/settings/password") {
    return NextResponse.redirect(new URL("/settings/password", req.nextUrl));
  }

  // Check route-level permissions against the MOST SPECIFIC matching route,
  // so e.g. /stock/products is governed by its own permissions, not /stock's
  const match = Object.entries(ROUTE_PERMISSIONS)
    .filter(([route]) => pathname.startsWith(route))
    .sort(([a], [b]) => b.length - a.length)[0];

  if (match) {
    if (!user) {
      return NextResponse.redirect(new URL("/login", req.nextUrl));
    }

    // An empty list means the route asks for nothing beyond being signed in.
    const required = match[1];
    const hasPermission =
      required.length === 0 ||
      required.some((perm) => user.permissions?.includes(perm));

    if (!hasPermission) {
      return NextResponse.redirect(new URL("/unauthorized", req.nextUrl));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|Just_logo.svg|.*\\.png$|.*\\.svg$).*)",
  ],
};
