"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { updateRoleHierarchy } from "@/lib/actions/roles";
import {
  Shield,
  Users,
  ChevronDown,
  GripVertical,
  Loader2,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  hierarchyLevel: number;
  /** `users` hold it as their main role, `heldAsAdditional` on top of another */
  _count: { users: number; heldAsAdditional: number };
}

interface Props {
  roles: Role[];
  canEdit: boolean;
}

export function RoleHierarchy({ roles, canEdit }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingRoleId, setPendingRoleId] = useState<string | null>(null);

  // Sort roles by hierarchyLevel ascending (lowest number = highest rank)
  const sortedRoles = [...roles].sort(
    (a, b) => a.hierarchyLevel - b.hierarchyLevel
  );

  // Group roles by hierarchyLevel
  const levelGroups = sortedRoles.reduce<Map<number, Role[]>>((map, role) => {
    const level = role.hierarchyLevel;
    if (!map.has(level)) {
      map.set(level, []);
    }
    map.get(level)!.push(role);
    return map;
  }, new Map());

  // Get sorted unique levels
  const levels = Array.from(levelGroups.keys()).sort((a, b) => a - b);

  function handleMoveUp(role: Role) {
    // Levels 0 and 1 belong to Super Admin and Admin
    if (role.hierarchyLevel <= 2) return;
    const newLevel = role.hierarchyLevel - 1;
    setPendingRoleId(role.id);
    startTransition(async () => {
      const result = await updateRoleHierarchy(role.id, newLevel);
      if (result && "error" in result) {
        toast.error(result.error);
      } else {
        toast.success(
          `Moved "${role.name}" up to level ${newLevel}`
        );
        router.refresh();
      }
      setPendingRoleId(null);
    });
  }

  function handleMoveDown(role: Role) {
    const newLevel = role.hierarchyLevel + 1;
    setPendingRoleId(role.id);
    startTransition(async () => {
      const result = await updateRoleHierarchy(role.id, newLevel);
      if (result && "error" in result) {
        toast.error(result.error);
      } else {
        toast.success(
          `Moved "${role.name}" down to level ${newLevel}`
        );
        router.refresh();
      }
      setPendingRoleId(null);
    });
  }

  // Super Admin and Admin are pinned to the top — no hierarchy controls
  const isLocked = (role: Role) =>
    role.name === "Super Admin" || role.name === "Admin";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green/10">
            <GripVertical className="h-5 w-5 text-brand-green" />
          </div>
          <div>
            <CardTitle className="text-base">Role Hierarchy</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Roles are ordered from highest authority (top) to lowest (bottom)
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center">
          {levels.map((level, levelIndex) => {
            const rolesAtLevel = levelGroups.get(level)!;
            const isLastLevel = levelIndex === levels.length - 1;

            return (
              <div key={level} className="w-full">
                {/* Level label */}
                <div className="flex items-center justify-center mb-3">
                  <div className="h-px flex-1 bg-border" />
                  <span className="px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Level {level}
                  </span>
                  <div className="h-px flex-1 bg-border" />
                </div>

                {/* Roles at this level - horizontal flex row */}
                <div className="flex flex-wrap items-stretch justify-center gap-3">
                  {rolesAtLevel.map((role, roleIndex) => {
                    const isRolePending = pendingRoleId === role.id;
                    const locked = isLocked(role);

                    return (
                      <div
                        key={role.id}
                        className="relative flex items-center gap-2"
                      >
                        {/* Lateral connector for multiple roles at same level */}
                        {roleIndex > 0 && (
                          <div className="flex items-center text-muted-foreground">
                            <div className="w-4 h-px bg-border" />
                          </div>
                        )}

                        {/* Role card */}
                        <div className="flex items-center gap-2 rounded-lg border bg-card p-3 min-w-[200px] max-w-[280px]">
                          {/* Edit controls */}
                          {canEdit && !locked && (
                            <div className="flex flex-col gap-0.5 -ml-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                disabled={
                                  isPending || role.hierarchyLevel <= 2
                                }
                                onClick={() => handleMoveUp(role)}
                              >
                                {isRolePending ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <ArrowUp className="h-3 w-3" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                disabled={isPending}
                                onClick={() => handleMoveDown(role)}
                              >
                                {isRolePending ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <ArrowDown className="h-3 w-3" />
                                )}
                              </Button>
                            </div>
                          )}

                          {/* Role icon */}
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-green/10">
                            <Shield className="h-4 w-4 text-brand-green" />
                          </div>

                          {/* Role info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">
                                {role.name}
                              </span>
                              <Badge variant="outline" className="text-[10px] shrink-0">
                                {level}
                              </Badge>
                            </div>
                            {role.description && (
                              <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                                {role.description}
                              </p>
                            )}
                            <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground">
                              <Users className="h-3 w-3" />
                              <span>
                                {role._count.users + role._count.heldAsAdditional}{" "}
                                {role._count.users + role._count.heldAsAdditional === 1
                                  ? "user"
                                  : "users"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Vertical connector between levels */}
                {!isLastLevel && (
                  <div className="flex flex-col items-center py-1">
                    <div className="h-4 w-px bg-border" />
                    <ChevronDown className="h-4 w-4 text-muted-foreground -my-1" />
                    <div className="h-4 w-px bg-border" />
                  </div>
                )}
              </div>
            );
          })}

          {/* Empty state */}
          {levels.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No roles found. Create roles to build your hierarchy.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
