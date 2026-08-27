"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Building2, Users, Eye } from "lucide-react";
import Link from "next/link";
import { DepartmentActions } from "./department-actions";

interface Department {
  id: string;
  name: string;
  description: string | null;
  locationId?: string | null;
  location?: { id: string; name: string } | null;
  isCentralStock?: boolean;
  isActive: boolean;
  _count: { users: number };
}

interface Props {
  departments: Department[];
  canEdit?: boolean;
  canDelete?: boolean;
  locations?: { id: string; name: string }[];
}

export function DepartmentList({ departments, canEdit = false, canDelete = false, locations = [] }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {departments.map((dept) => (
        <Card key={dept.id} className={!dept.isActive ? "opacity-60" : ""}>
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-blue/10">
                  <Building2 className="h-5 w-5 text-brand-blue" />
                </div>
                <div>
                  <h3 className="font-semibold">{dept.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {dept.location?.name ?? "No location set"}
                  </p>
                  {dept.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                      {dept.description}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {!dept.isActive && (
                  <Badge variant="secondary" className="text-[10px]">
                    Inactive
                  </Badge>
                )}
                <DepartmentActions
                  department={dept}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  locations={locations}
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                {dept._count.users}{" "}
                {dept._count.users === 1 ? "member" : "members"}
              </span>
              <Link href={`/departments/${dept.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                <Eye className="mr-1.5 h-3.5 w-3.5" />
                View
              </Link>
            </div>
          </CardContent>
        </Card>
      ))}
      {departments.length === 0 && (
        <div className="col-span-full text-center py-12 text-muted-foreground">
          No departments created yet. Create your first department to get started.
        </div>
      )}
    </div>
  );
}
