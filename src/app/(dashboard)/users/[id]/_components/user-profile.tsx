"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DeleteDialog } from "@/components/shared/delete-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { PasswordCard } from "./password-card";
import { updateUser, toggleUserStatus, deleteUser } from "@/lib/actions/users";
import { toast } from "sonner";
import {
  Pencil,
  Save,
  X,
  UserX,
  UserCheck,
  Loader2,
  ArrowLeft,
  Trash2,
} from "lucide-react";
import Link from "next/link";

interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  avatar: string | null;
  createdAt: Date;
  role: { id: string; name: string };
  department: { id: string; name: string } | null;
}

interface PasswordMeta {
  canReveal: boolean;
  setAt: Date | null;
  setBy: string | null;
}

interface Props {
  user: User;
  roles: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  /** Every role the viewer holds, primary first */
  currentUserRoles: string[];
  currentUserPermissions: string[];
  currentUserId: string;
  passwordMeta: PasswordMeta | null;
  /**
   * Rendered into the right-hand column alongside Details and Password, so the
   * page reads as one identity column and one column of cards rather than
   * three unrelated stacked blocks. Built by the page because it needs data
   * this component does not have.
   */
  extraPermissions?: React.ReactNode;
  /** Same idea as extraPermissions — built by the page, rendered here */
  additionalRoles?: React.ReactNode;
}

export function UserProfile({
  user,
  roles,
  departments,
  currentUserRoles,
  currentUserPermissions,
  currentUserId,
  passwordMeta,
  extraPermissions,
  additionalRoles,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showToggle, setShowToggle] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteWarning, setDeleteWarning] = useState<{
    message: string;
    recommendation: string;
  } | null>(null);

  const [form, setForm] = useState({
    name: user.name,
    email: user.email,
    phone: user.phone ?? "",
    roleId: user.role.id,
    roleName: user.role.name,
    departmentId: user.department?.id ?? "",
  });

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // Super Admin protection: only Super Admin can edit/disable another Super Admin.
  // Buttons only render when the viewer actually holds the permission.
  const isSuperAdminTarget = user.role.name === "Super Admin";
  const isSuperAdminViewer = currentUserRoles.includes("Super Admin");
  const isSelf = user.id === currentUserId;
  const canModify =
    currentUserPermissions.includes("users.edit") &&
    (!isSuperAdminTarget || isSuperAdminViewer);
  const canToggleStatus =
    canModify && !isSelf && currentUserPermissions.includes("users.delete");
  // Credentials are gated by their own permissions, so a role can be allowed to
  // read passwords without changing them (or the other way round). The Super
  // Admin's password is off-limits to everyone but the Super Admin.
  const canViewPassword =
    currentUserPermissions.includes("users.password.view") &&
    (!isSuperAdminTarget || isSuperAdminViewer);
  const canEditPassword =
    currentUserPermissions.includes("users.password.edit") &&
    (!isSuperAdminTarget || isSuperAdminViewer);
  // Hard deletion is an admin action; guarded further server-side
  const canDelete =
    !isSelf &&
    currentUserPermissions.includes("users.delete") &&
    (isSuperAdminViewer || currentUserRoles.includes("Admin")) &&
    (!isSuperAdminTarget || isSuperAdminViewer);

  // Two steps by design: the first call reports what would be destroyed and
  // recommends deactivating, the second insists. Blocking outright was the old
  // behaviour, and since activity history counts as a linked record it made the
  // button useless.
  const openDelete = async () => {
    const result = await deleteUser(user.id);
    if ("error" in result && result.error) {
      toast.error(result.error);
      return;
    }
    if ("needsConfirmation" in result && result.needsConfirmation) {
      setDeleteWarning({
        message: result.message ?? "",
        recommendation: result.recommendation ?? "",
      });
      setShowDelete(true);
      return;
    }
    // Nothing referenced them, so it is already gone
    toast.success(`Account "${user.name}" deleted`);
    router.push("/users");
    router.refresh();
  };

  const handleDelete = async () => {
    const result = await deleteUser(user.id, { force: true });
    if ("error" in result && result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`Account "${user.name}" deleted — their history was kept under their name`);
    router.push("/users");
    router.refresh();
  };

  const handleDeactivate = async () => {
    const result = await toggleUserStatus(user.id);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`${user.name} deactivated`);
    setShowDelete(false);
    router.refresh();
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const result = await updateUser(user.id, {
        ...form,
        departmentId: form.departmentId || undefined,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Profile updated successfully!");
      setEditing(false);
      router.refresh();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async () => {
    const result = await toggleUserStatus(user.id);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(
      user.isActive
        ? "Account has been deactivated"
        : "Account has been activated"
    );
    router.refresh();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={editing ? "Edit Profile" : user.name}
        description={editing ? "Update this team member's details" : undefined}
      >
        <Link href="/users" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Link>
      </PageHeader>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        {/* Profile Card */}
        <Card className="lg:col-span-1 lg:sticky lg:top-[4.5rem]">
          <CardContent className="p-6 text-center">
            <Avatar className="h-20 w-20 mx-auto">
              <AvatarFallback className="bg-brand-green/10 text-brand-green text-2xl font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <h2 className="mt-4 text-lg font-semibold">{user.name}</h2>
            <div className="flex justify-center gap-2 mt-2">
              <Badge variant="outline">{user.role.name}</Badge>
              <Badge
                variant={user.isActive ? "default" : "secondary"}
                className={
                  user.isActive
                    ? "bg-green-100 text-green-800 hover:bg-green-100"
                    : ""
                }
              >
                {user.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>

            {user.department && (
              <p className="mt-1 text-caption text-muted-foreground">
                {user.department.name}
              </p>
            )}

            {/*
              Identity only. Email, phone, role and department used to be
              printed here *and* again in the details card on the right, which
              made the page read as two half-filled columns saying the same
              thing. Every field now lives once, on the right.
            */}
            {canModify && (
              <div className="mt-6 flex flex-col gap-2">
                {!editing && (
                  <Button variant="outline" className="w-full" onClick={() => setEditing(true)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit profile
                  </Button>
                )}

                {(canToggleStatus || canDelete) && (
                  <div className="mt-2 border-t pt-3">
                    <p className="mb-2 text-micro font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      Manage account
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {/*
                        Disabling is the ordinary action, so it stays plain.
                        Two equally-red buttons stacked meant neither read as
                        the safer one.
                      */}
                      {canToggleStatus && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="justify-start"
                          onClick={() => setShowToggle(true)}
                        >
                          {user.isActive ? (
                            <>
                              <UserX className="mr-2 h-4 w-4" />
                              Disable account
                            </>
                          ) : (
                            <>
                              <UserCheck className="mr-2 h-4 w-4" />
                              Enable account
                            </>
                          )}
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="justify-start text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={openDelete}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete account
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            {!canModify && isSuperAdminTarget && (
              <div className="mt-6">
                <p className="text-xs text-muted-foreground text-center">
                  Super Admin account cannot be modified
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/*
          Details, Password and Extra permissions are one stacked column, not
          three separate grid items. As grid children they each landed in their
          own row, so the tall identity card on the left set the height of row
          one and left a gap under Details before Password began.
        */}
        <div className="flex flex-col gap-6 lg:col-span-2">
        {/* Details / Edit Form */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>
              {editing ? "Edit Details" : "Profile Details"}
            </CardTitle>
            {editing && (
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    setForm({
                      name: user.name,
                      email: user.email,
                      phone: user.phone ?? "",
                      roleId: user.role.id,
                      roleName: user.role.name,
                      departmentId: user.department?.id ?? "",
                    });
                  }}
                >
                  <X className="mr-1 h-4 w-4" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={loading}
                  className="bg-brand-green hover:bg-brand-green/90 text-brand-navy"
                >
                  {loading ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-1 h-4 w-4" />
                  )}
                  Save Changes
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Full Name</Label>
                {editing ? (
                  <Input
                    value={form.name}
                    onChange={(e) =>
                      setForm({ ...form, name: e.target.value })
                    }
                  />
                ) : (
                  <p className="px-0.5 py-1.5 text-sm">
                    {user.name}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Email Address</Label>
                {editing ? (
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                  />
                ) : (
                  <p className="px-0.5 py-1.5 text-sm">
                    {user.email}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Phone</Label>
                {editing ? (
                  <Input
                    value={form.phone}
                    onChange={(e) =>
                      setForm({ ...form, phone: e.target.value })
                    }
                    placeholder="Optional"
                  />
                ) : (
                  <p className="px-0.5 py-1.5 text-sm">
                    {user.phone || "Not provided"}
                  </p>
                )}
              </div>

              <div className="space-y-2 width-fit">
                <Label>Role</Label>
                {editing ? (
                  <Select
                    value={form.roleId}
                    items={roles.map((r) => ({ value: r.id, label: r.name }))}
                    onValueChange={(v) => setForm({ ...form, roleId: v as string })}
                  >
                    <SelectTrigger>
                      <SelectValue className="w-full"/>
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="px-0.5 py-1.5 text-sm">
                    {user.role.name}
                  </p>
                )}
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label>Department</Label>
                {editing ? (
                  <Select
                    value={form.departmentId || "none"}
                    items={[
                      { value: "none", label: "No department" },
                      ...departments.map((d) => ({ value: d.id, label: d.name })),
                    ]}
                    onValueChange={(v) =>
                      setForm({ ...form, departmentId: (v as string) === "none" ? "" : (v as string) })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No department</SelectItem>
                      {departments.map((dept) => (
                        <SelectItem key={dept.id} value={dept.id}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="px-0.5 py-1.5 text-sm">
                    {user.department?.name ?? "Not assigned"}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {passwordMeta && (canViewPassword || canEditPassword) && (
          <PasswordCard
            userId={user.id}
            userName={user.name}
            meta={passwordMeta}
            canView={canViewPassword}
            canEdit={canEditPassword}
          />
        )}

        {additionalRoles}
        {extraPermissions}
        </div>
      </div>

      <ConfirmDialog
        open={showToggle}
        onOpenChange={setShowToggle}
        title={
          user.isActive ? "Disable this account?" : "Enable this account?"
        }
        description={
          user.isActive
            ? `${user.name} will no longer be able to sign in. You can re-enable the account at any time.`
            : `${user.name} will be able to sign in again.`
        }
        confirmLabel={user.isActive ? "Disable Account" : "Enable Account"}
        onConfirm={handleToggleStatus}
        destructive={user.isActive}
      />

      {showDelete && (
        <DeleteDialog
          open
          onOpenChange={setShowDelete}
          name={user.name}
          consequence={
            deleteWarning?.message ?? `This permanently removes ${user.name}'s account.`
          }
          deactivateHint={
            deleteWarning?.recommendation ??
            "Deactivating removes them from every list and stops them signing in, while their history stays attached to their name."
          }
          onDeactivate={user.isActive ? handleDeactivate : undefined}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
