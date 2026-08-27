"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Users, Eye, Loader2, UserMinus } from "lucide-react";
import Link from "next/link";
import { removeUserFromDepartment } from "@/lib/actions/departments";
import { AddMemberDialog } from "./add-member-dialog";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface Department {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  _count: { users: number };
  users: Array<{
    id: string;
    name: string;
    email: string;
    isActive: boolean;
    avatar: string | null;
    role: { name: string };
  }>;
}

interface Candidate {
  id: string;
  name: string;
  email: string;
  role: { name: string };
  department: { name: string } | null;
}

interface Props {
  department: Department;
  canManageMembers?: boolean;
  canCreateUsers?: boolean;
  roles?: Array<{ id: string; name: string }>;
  candidates?: Candidate[];
  currentUserId?: string;
}

export function DepartmentDetail({
  department,
  canManageMembers = false,
  canCreateUsers = false,
  roles = [],
  candidates = [],
  currentUserId,
}: Props) {
  const router = useRouter();
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function handleRemove(member: { id: string; name: string }) {
    setRemovingId(member.id);
    try {
      const result = await removeUserFromDepartment(member.id);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${member.name} removed from ${department.name}`);
      router.refresh();
    } finally {
      setRemovingId(null);
    }
  }
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Overview */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground">Status</p>
            <Badge
              variant={department.isActive ? "default" : "secondary"}
              className={
                department.isActive
                  ? "bg-green-100 text-green-800 hover:bg-green-100"
                  : ""
              }
            >
              {department.isActive ? "Active" : "Inactive"}
            </Badge>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Members</p>
            <div className="flex items-center gap-1.5 mt-1">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold">{department._count.users}</span>
            </div>
          </div>
          {department.description && (
            <div>
              <p className="text-sm text-muted-foreground">Description</p>
              <p className="text-sm mt-1">{department.description}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Members */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Team Members ({department.users.length})</CardTitle>
            {canManageMembers && department.isActive && (
              <AddMemberDialog
                departmentId={department.id}
                departmentName={department.name}
                candidates={candidates}
                canCreateUsers={canCreateUsers}
                roles={roles}
              />
            )}
          </div>
        </CardHeader>
        <CardContent>
          {department.users.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No members in this department yet.
            </p>
          ) : (
            <div className="space-y-3">
              {department.users.map((member) => {
                const initials = member.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2);

                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-brand-green/10 text-brand-green text-xs font-semibold">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <span
                          className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white ${
                            member.isActive ? "bg-green-500" : "bg-gray-400"
                          }`}
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {member.name}
                          {member.id === currentUserId && (
                            <span className="ml-1.5 text-xs font-medium text-black">(you)</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {member.email}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {member.role.name}
                      </Badge>
                      <Link href={`/users/${member.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                        <Eye className="h-3.5 w-3.5" />
                      </Link>
                      {canManageMembers && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={removingId !== null}
                          onClick={() => handleRemove(member)}
                          title={`Remove ${member.name} from this department`}
                        >
                          {removingId === member.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <UserMinus className="h-3.5 w-3.5 text-destructive" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
