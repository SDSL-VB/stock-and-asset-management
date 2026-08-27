"use client";

import type { Session } from "next-auth";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { NAV_ITEMS, NAV_GROUPS } from "@/lib/constants";

interface Props {
  session?: Session | null;
}

export function AppSidebar({ session }: Props) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const userPermissions = session?.user?.permissions ?? [];
  const userRole = session?.user?.role ?? "";

  // Filter nav items based on permissions
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.anyPermission)
      return item.anyPermission.some((p) => userPermissions.includes(p));
    if (!item.permission) return true;
    return userPermissions.includes(item.permission);
  });

  // Group items
  const groups = Object.entries(NAV_GROUPS)
    .map(([key, label]) => ({
      key,
      label,
      items: visibleItems.filter((item) => item.group === key),
    }))
    .filter((group) => group.items.length > 0);

  const initials = session?.user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) ?? "U";

  return (
    <Sidebar className="border-r-0">
      <SidebarHeader className="border-b border-sidebar-border px-5 py-4">
        <Link
          href="/dashboard"
          className="group/brand flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 ease-out-quart group-hover/brand:scale-105">
            <img
              src="/Just_logo.svg"
              alt="Straight Drive Logo"
              className="h-8 w-8 rounded-lg bg-transparent"
            />
          </div>
          <div className="min-w-0">
            <span className="block truncate text-caption font-bold tracking-[0.06em] text-sidebar-foreground">
              Straight Drive
            </span>
            <p className="truncate text-micro text-sidebar-foreground/55">
              Stock Inventory Management
            </p>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-3 py-4">
        {groups.map((group) => (
          <SidebarGroup key={group.key}>
            <SidebarGroupLabel className="mb-1 text-micro font-bold tracking-[0.13em] text-sidebar-foreground/35 uppercase">
              {group.label}
            </SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => {
                // Exact match, or prefix match with boundary (next char is / or end)
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/dashboard" &&
                    pathname.startsWith(item.href) &&
                    (pathname.length === item.href.length ||
                      pathname[item.href.length] === "/") &&
                    // Ensure a more specific nav item doesn't also exist
                    !visibleItems.some(
                      (other) =>
                        other.href !== item.href &&
                        other.href.startsWith(item.href) &&
                        pathname.startsWith(other.href)
                    ));

                return (
                  <SidebarMenuItem key={item.href}>
                    {/* The active pill is a separate layer so it can slide
                        between items rather than cutting. layoutId is what
                        makes motion treat every instance as the same object. */}
                    {isActive &&
                      (reduce ? (
                        <div className="absolute inset-0 rounded-md bg-brand-green" />
                      ) : (
                        <motion.div
                          layoutId="sidebar-active-pill"
                          className="absolute inset-0 rounded-md bg-brand-green"
                          transition={{
                            type: "spring",
                            stiffness: 420,
                            damping: 34,
                            mass: 0.8,
                          }}
                        />
                      ))}
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={isActive}
                      tooltip={item.label}
                      className={
                        isActive
                          ? "relative z-10 bg-transparent font-bold text-brand-navy data-active:bg-transparent data-active:text-brand-navy hover:bg-transparent hover:text-brand-navy active:bg-transparent"
                          : "relative z-10 text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                      }
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarFallback className="bg-brand-green/20 text-caption font-bold text-brand-green">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-semibold text-sidebar-foreground">
              {session?.user?.name ?? "User"}
            </p>
            {userRole && (
              <Badge
                variant="outline"
                className="mt-0.5 border-sidebar-border px-1.5 py-0 text-micro font-semibold tracking-wide text-sidebar-foreground/60 uppercase"
              >
                {userRole}
              </Badge>
            )}
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
