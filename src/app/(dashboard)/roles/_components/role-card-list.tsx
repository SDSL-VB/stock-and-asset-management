"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Shield, Users, Settings2, Plus, Trash2, Loader2 } from "lucide-react";
import Link from "next/link";
import { createRole, deleteRole } from "@/lib/actions/roles";
import { toast } from "sonner";

interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  /** `users` hold it as their main role, `heldAsAdditional` on top of another */
  _count: { users: number; heldAsAdditional: number };
  permissions: Array<{
    permission: { id: string; key: string; name: string; module: string };
  }>;
}

interface Props {
  roles: Role[];
  simplified: boolean;
  canCreate: boolean;
  canDelete: boolean;
  currentUserRole: string;
}

export function RoleCardList({ roles, simplified, canCreate, canDelete }: Props) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", description: "", isSystem: false });
  const [isPending, startTransition] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);

  function handleCreate() {
    if (!createForm.name.trim()) {
      toast.error("Role name is required");
      return;
    }
    startTransition(async () => {
      const result = await createRole({
        name: createForm.name.trim(),
        description: createForm.description.trim() || undefined,
        isSystem: createForm.isSystem,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Role "${createForm.name}" created`);
      setShowCreate(false);
      setCreateForm({ name: "", description: "", isSystem: false });
      router.refresh();
    });
  }

  function handleDelete() {
    if (!deleteTarget) return;
    startTransition(async () => {
      const result = await deleteRole(deleteTarget.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Role "${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      router.refresh();
    });
  }

  return (
    <>
      {canCreate && (
        <div className="flex justify-end mb-4">
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Role
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {roles.map((role) => {
          // A role is held two ways: as someone's main role, and as one they
          // hold on top of it. Both count towards "in use".
          const holders = role._count.users + role._count.heldAsAdditional;

          // System roles and roles in use can't be removed; show the button
          // disabled with an explanation so admins know why
          const deleteBlockedReason = role.isSystem
            ? "System roles cannot be deleted"
            : holders > 0
              ? `Reassign its ${holders} user${holders === 1 ? "" : "s"} first`
              : null;

          return (
            <Card key={role.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green/10">
                      <Shield className="h-5 w-5 text-brand-green" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{role.name}</CardTitle>
                      {role.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {role.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {role.isSystem && (
                      <Badge variant="outline" className="text-[10px]">
                        System
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {holders} {holders === 1 ? "user" : "users"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Shield className="h-3.5 w-3.5" />
                      {role.permissions.length} permissions
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {canDelete && (
                      <span title={deleteBlockedReason ?? `Delete "${role.name}"`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!!deleteBlockedReason}
                          onClick={() => setDeleteTarget(role)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    )}
                    <Link
                      href={`/roles/${role.id}`}
                      className={cn(
                        buttonVariants({ variant: "ghost", size: "sm" })
                      )}
                    >
                      <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                      {simplified ? "Manage" : "Edit Permissions"}
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Create Role Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Role</DialogTitle>
            <DialogDescription>
              Create a custom role. You can assign permissions after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="roleName">Role Name *</Label>
              <Input
                id="roleName"
                value={createForm.name}
                onChange={(e) =>
                  setCreateForm({ ...createForm, name: e.target.value })
                }
                placeholder="e.g. Warehouse Manager"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="roleDesc">Description</Label>
              <Input
                id="roleDesc"
                value={createForm.description}
                onChange={(e) =>
                  setCreateForm({ ...createForm, description: e.target.value })
                }
                placeholder="Optional description"
              />
            </div>
            <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
              <div>
                <Label htmlFor="roleSystem">System role</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  System roles are protected — they can never be deleted.
                </p>
              </div>
              <Switch
                id="roleSystem"
                checked={createForm.isSystem}
                onCheckedChange={(v) =>
                  setCreateForm({ ...createForm, isSystem: v })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreate(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Role Confirm Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="This role will be permanently deleted. This cannot be undone."
        confirmLabel="Delete Role"
        onConfirm={handleDelete}
        destructive
      />
    </>
  );
}
