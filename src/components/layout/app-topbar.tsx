"use client";

import type { Session } from "next-auth";
import { signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { cn } from "@/lib/utils";
import { LogOut, UserCircle } from "lucide-react";
import Link from "next/link";
import React from "react";

const ROUTE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  users: "Team Members",
  roles: "Roles",
  departments: "Departments",
  activity: "Activity Log",
  settings: "Settings",
  profile: "My Profile",
  new: "Add New",
  stock: "Stock Entries",
  reports: "Reports",
  configure: "Configuration",
  products: "Catalog",
  bom: "Bills of Materials",
  builds: "Builds",
  procurement: "Procurement",
  fulfilment: "Fulfilment",
  "recycle-bin": "Recycle Bin",
  vendors: "Vendors",
  clients: "Clients",
  assets: "Assets",
  dispatch: "Dispatch",
  edit: "Edit",
};

/**
 * Record IDs are cuids, so a raw /stock/<id> route used to render 25 characters
 * of noise as a breadcrumb. Anything long and unbroken is an ID, not a word.
 */
function isRecordId(segment: string): boolean {
  return /^[a-z0-9_-]{16,}$/i.test(segment);
}

function labelFor(segment: string): string {
  if (ROUTE_LABELS[segment]) return ROUTE_LABELS[segment];
  if (isRecordId(segment)) return "Details";
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

interface Props {
  session?: Session | null;
}

export function AppTopbar({ session }: Props) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = React.useState(false);

  const user = session?.user;

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const segments = pathname.split("/").filter(Boolean);
  const breadcrumbs = segments.map((seg, i) => ({
    label: labelFor(seg),
    href: "/" + segments.slice(0, i + 1).join("/"),
    isLast: i === segments.length - 1,
  }));

  const initials = user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) ?? "U";

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-md transition-shadow duration-200 sm:px-6",
        scrolled && "shadow-sm"
      )}
    >
      <SidebarTrigger className="-ml-1.5 shrink-0" />
      <Separator orientation="vertical" className="h-6 shrink-0" />

      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={crumb.href}>
              {i > 0 && <BreadcrumbSeparator className="shrink-0" />}
              <BreadcrumbItem className="min-w-0">
                {crumb.isLast ? (
                  <BreadcrumbPage className="truncate font-semibold">
                    {crumb.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    render={<Link href={crumb.href} />}
                    className="truncate transition-colors hover:text-foreground"
                  >
                    {crumb.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <ThemeToggle />

      <DropdownMenu>
        <DropdownMenuTrigger className="flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-brand-green/20 text-caption font-bold text-brand-green">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="hidden text-left md:block">
            <p className="text-body leading-none font-semibold">
              {user?.name ?? "Loading..."}
            </p>
            {user?.role && (
              <Badge
                variant="secondary"
                className="mt-1 px-1.5 py-0 text-micro font-semibold tracking-wide uppercase"
              >
                {user.role}
              </Badge>
            )}
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-fit">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="font-normal">
              <p className="text-body font-semibold">{user?.name}</p>
              <p className="text-caption text-muted-foreground">
                {user?.email}
              </p>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem render={<Link href="/settings/profile" />} className="cursor-pointer">
            <UserCircle className="mr-2 h-4 w-4" />
            My Profile
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="cursor-pointer text-destructive"
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
