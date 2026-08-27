"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addUserRole, removeUserRole } from "@/lib/actions/users";
import { toast } from "sonner";
import { Plus, X, Layers } from "lucide-react";

/**
 * Roles this person holds on top of their main one.
 *
 * Jobs are not job titles. Someone can book stock in AND run dispatch, or run a
 * department AND do the buying, without anyone inventing a role per combination.
 * Their permissions are the union of every role here plus their main one.
 *
 * Rendered only for holders of users.edit, and never on your own profile — you
 * cannot hand yourself a second role.
 */

type Held = {
  roleId: string;
  reason: string | null;
  createdAt: Date;
  role: { id: string; name: string };
  grantedBy: { name: string } | null;
};

interface Props {
  userId: string;
  userName: string;
  primaryRoleName: string;
  held: Held[];
  /** Roles the viewer is allowed to hand out — their own rank or below */
  assignable: { id: string; name: string }[];
}

export function AdditionalRolesCard({
  userId,
  userName,
  primaryRoleName,
  held,
  assignable,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [roleId, setRoleId] = useState("");
  const [reason, setReason] = useState("");

  // Neither their main role nor one they already hold is worth offering
  const alreadyHeld = new Set([primaryRoleName, ...held.map((h) => h.role.name)]);
  const options = assignable.filter((r) => !alreadyHeld.has(r.name));

  function handleAdd() {
    startTransition(async () => {
      const result = await addUserRole(userId, roleId, reason);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const name = options.find((r) => r.id === roleId)?.name ?? "role";
      toast.success(`${userName} now also holds ${name}`);
      setAdding(false);
      setRoleId("");
      setReason("");
      router.refresh();
    });
  }

  function handleRemove(h: Held) {
    startTransition(async () => {
      const result = await removeUserRole(userId, h.roleId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Removed ${h.role.name} from ${userName}`);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-muted-foreground" />
            Additional roles
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Held on top of {primaryRoleName}. Permissions add up across all of them.
          </p>
        </div>
        {!adding && options.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Add
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {held.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">
            {userName} holds only their main role.
          </p>
        )}

        {held.length > 0 && (
          <ul className="space-y-2">
            {held.map((h) => (
              <li
                key={h.roleId}
                className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <Badge variant="outline">{h.role.name}</Badge>
                  {h.reason && (
                    <p className="mt-1 text-xs text-muted-foreground">{h.reason}</p>
                  )}
                  {h.grantedBy && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Added by {h.grantedBy.name} ·{" "}
                      {new Date(h.createdAt).toLocaleDateString("en-IN")}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => handleRemove(h)}
                  aria-label={`Remove ${h.role.name}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {adding && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="space-y-2">
              <Label htmlFor="extra-role">Role</Label>
              <Select
                value={roleId}
                items={options.map((r) => ({ value: r.id, label: r.name }))}
                onValueChange={(v) => setRoleId((v as string) ?? "")}
              >
                <SelectTrigger id="extra-role">
                  <SelectValue placeholder="Choose a role" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="extra-role-reason">Why do they need it? *</Label>
              <Input
                id="extra-role-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Also runs dispatch for Bengaluru"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAdding(false);
                  setRoleId("");
                  setReason("");
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={pending || !roleId || reason.trim().length < 3}
                onClick={handleAdd}
              >
                Add role
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
