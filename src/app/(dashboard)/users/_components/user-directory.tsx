"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Search, MapPin, Mail, Phone, Users, ChevronRight } from "lucide-react";

type DirectoryUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  role: { id: string; name: string };
  department:
    | { id: string; name: string; location: { id: string; name: string } | null }
    | null;
};

interface Props {
  users: DirectoryUser[];
  currentUserId: string;
}

const ROLE_STYLES: Record<string, string> = {
  "Super Admin": "bg-purple-100 text-purple-800 border-purple-200",
  Admin: "bg-blue-100 text-blue-800 border-blue-200",
  "Department Manager": "bg-indigo-100 text-indigo-800 border-indigo-200",
  "Central Stock Manager": "bg-teal-100 text-teal-800 border-teal-200",
  "Dispatch Operator": "bg-sky-100 text-sky-800 border-sky-200",
  "Stock Entry Operator": "bg-amber-100 text-amber-800 border-amber-200",
  Auditor: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * One directory for everyone. The page used to show cards to a Super Admin and
 * a table to everyone else, which meant the same job looked like two different
 * features depending on who opened it — and it keyed off the role's *name*,
 * which nothing else in this system does.
 *
 * People are grouped by department, because department is now what carries a
 * person's location, and "who is at Bengaluru central stock" is a question this
 * page should answer at a glance.
 */
export function UserDirectory({ users, currentUserId }: Props) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");

  const roles = useMemo(
    () => [...new Set(users.map((u) => u.role.name))].sort(),
    [users]
  );
  const departments = useMemo(
    () => [...new Set(users.map((u) => u.department?.name ?? "No department"))].sort(),
    [users]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "all" && u.role.name !== roleFilter) return false;
      const dept = u.department?.name ?? "No department";
      if (departmentFilter !== "all" && dept !== departmentFilter) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.phone ?? "").toLowerCase().includes(q) ||
        u.role.name.toLowerCase().includes(q) ||
        dept.toLowerCase().includes(q) ||
        (u.department?.location?.name ?? "").toLowerCase().includes(q)
      );
    });
  }, [users, search, roleFilter, departmentFilter]);

  // Grouped by department, with people who have none last
  const groups = useMemo(() => {
    const map = new Map<string, { location: string | null; people: DirectoryUser[] }>();
    for (const u of filtered) {
      const key = u.department?.name ?? "No department";
      if (!map.has(key)) {
        map.set(key, { location: u.department?.location?.name ?? null, people: [] });
      }
      map.get(key)!.people.push(u);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === "No department") return 1;
      if (b === "No department") return -1;
      return a.localeCompare(b);
    });
  }, [filtered]);

  const activeCount = filtered.filter((u) => u.isActive).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, phone, role, department, or site..."
            className="pl-9"
          />
        </div>
        <Select
          value={roleFilter}
          items={[
            { value: "all", label: "All roles" },
            ...roles.map((r) => ({ value: r, label: r })),
          ]}
          onValueChange={(v) => setRoleFilter((v as string) ?? "all")}
        >
          <SelectTrigger className="w-[190px]">
            <SelectValue placeholder="All roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {roles.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={departmentFilter}
          items={[
            { value: "all", label: "All departments" },
            ...departments.map((d) => ({ value: d, label: d })),
          ]}
          onValueChange={(v) => setDepartmentFilter((v as string) ?? "all")}
        >
          <SelectTrigger className="w-[210px]">
            <SelectValue placeholder="All departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d} value={d}>
                {d}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? "person" : "people"}
        {filtered.length !== activeCount && ` · ${activeCount} active`}
        {groups.length > 1 && ` · ${groups.length} departments`}
      </p>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            Nobody matches that search.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map(([deptName, group]) => (
            <div key={deptName} className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  {deptName}
                </h2>
                {group.location && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {group.location}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {group.people.length}{" "}
                  {group.people.length === 1 ? "person" : "people"}
                </span>
              </div>

              <Card>
                <CardContent className="divide-y p-0">
                  {group.people.map((u) => (
                    <Link
                      key={u.id}
                      href={`/users/${u.id}`}
                      className={cn(
                        "flex items-center gap-4 p-4 transition hover:bg-muted/50",
                        !u.isActive && "opacity-60"
                      )}
                    >
                      <Avatar className="h-10 w-10 shrink-0">
                        <AvatarFallback className="bg-brand-green/10 text-sm font-semibold text-brand-green">
                          {initials(u.name)}
                        </AvatarFallback>
                      </Avatar>

                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {u.name}
                          {u.id === currentUserId && (
                            <span className="text-xs font-normal text-muted-foreground">
                              (you)
                            </span>
                          )}
                          {!u.isActive && (
                            <Badge variant="secondary" className="text-[10px]">
                              Inactive
                            </Badge>
                          )}
                        </p>
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="flex min-w-0 items-center gap-1 truncate">
                            <Mail className="h-3 w-3 shrink-0" />
                            {u.email}
                          </span>
                          {u.phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {u.phone}
                            </span>
                          )}
                        </p>
                      </div>

                      <Badge
                        variant="outline"
                        className={cn("shrink-0", ROLE_STYLES[u.role.name] ?? "")}
                      >
                        {u.role.name}
                      </Badge>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  ))}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
