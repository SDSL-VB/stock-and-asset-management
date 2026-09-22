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
  // Wider than stock.writeoff.view: the review queue lives on this page too.
  // Keep in step with WASTAGE_PAGE_PERMISSIONS.
  "/wastage": ["stock.writeoff.view", "stock.writeoff.approve"],
  // Keep in step with DISPATCH_PAGE_PERMISSIONS. The fulfilment keys are here
  // because site requests moved onto this page from the old Fulfilment page.
  "/dispatch": [
    "dispatch.view",
    "dispatch.create",
    "dispatch.accept",
    "dispatch.receive",
    "dispatch.export",
    "fulfilment.view",
    "fulfilment.request",
    "fulfilment.approve",
  ],
  "/activity": ["activity.view"],
  "/settings": ["settings.view"],
  // Changing your own password is not a capability an admin can withhold, so it
  // is gated on nothing beyond being signed in — and it must stay reachable by
  // someone requireAuth() is redirecting here, or that redirect would loop.
  "/settings/password": [],
  // Your own profile is not a setting. It sits under /settings only by URL, and
  // the longest-prefix rule below would otherwise hand it to the line above —
  // which sent everyone without settings.view to /unauthorized from a link
  // their own sidebar showed them. An empty list means "signed in is enough",
  // matching the page's own requireAuth() gate.
  "/settings/profile": [],
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
  // Keep in step with BUILDS_PAGE_PERMISSIONS: fulfilment.view opens the Plan tab
  "/builds": ["bom.view", "bom.build", "bom.unbuild", "fulfilment.view"],
  "/recycle-bin": ["recyclebin.view", "recyclebin.restore", "recyclebin.purge"],
  "/reports": ["reports.view"],
  "/procurement": [
    "procurement.intent.view",
    "procurement.intent.create",
    "procurement.intent.approve",
    "procurement.po.view",
    "procurement.po.create",
    "procurement.po.close",
    // The low-stock alert lives on this page. Keep in step with PROCUREMENT_PAGE_PERMISSIONS.
    "stock.lowstock.view",
  ],
};

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const user = req.auth?.user;

  // The forced password change is NOT checked here, deliberately. This file runs
  // on the Edge and can read only the session cookie, and that cookie is written
  // at sign-in and never updated afterwards — a page is a React Server Component
  // and cannot write cookies. So a cookie minted while the flag was set kept
  // saying so for the full 24-hour session even after the person had changed
  // their password, and they were sent back here every time. requireAuth() in
  // src/lib/rbac/check.ts does it instead, against a value re-read from the
  // database.

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
