"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addUserToDepartment } from "@/lib/actions/departments";
import { createUser } from "@/lib/actions/users";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Search, UserPlus } from "lucide-react";

interface Candidate {
  id: string;
  name: string;
  email: string;
  role: { name: string };
  department: { name: string } | null;
}

interface Props {
  departmentId: string;
  departmentName: string;
  candidates: Candidate[];
  /** Shows the "create a brand-new member" flow (requires users.create) */
  canCreateUsers?: boolean;
  roles?: Array<{ id: string; name: string }>;
}

export function AddMemberDialog({
  departmentId,
  departmentName,
  candidates,
  canCreateUsers = false,
  roles = [],
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);

  // Create-new-member mode (shown when the person isn't found)
  const [creating, setCreating] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", roleId: "" });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  }, [candidates, search]);

  async function handleAdd(user: Candidate) {
    setAddingId(user.id);
    try {
      const result = await addUserToDepartment(user.id, departmentId);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${user.name} added to ${departmentName}`);
      router.refresh();
    } finally {
      setAddingId(null);
    }
  }

  function startCreate() {
    const q = search.trim();
    // Carry the search over: it's the name they looked for (or email if typed)
    setForm({
      name: q.includes("@") ? "" : q,
      email: q.includes("@") ? q : "",
      password: "",
      roleId: "",
    });
    setCreating(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateLoading(true);
    try {
      const result = await createUser({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        roleId: form.roleId,
        departmentId,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${form.name.trim()} created and added to ${departmentName}`);
      setCreating(false);
      setSearch("");
      router.refresh();
    } finally {
      setCreateLoading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setCreating(false);
      setSearch("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm" className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold" />
        }
      >
        <UserPlus className="mr-2 h-4 w-4" />
        Add Member
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {creating
              ? `New Member for ${departmentName}`
              : `Add Members to ${departmentName}`}
          </DialogTitle>
        </DialogHeader>

        {creating ? (
          <form onSubmit={handleCreate} className="space-y-4">
            <p className="text-xs text-muted-foreground">
              This creates a brand-new account and places it straight into{" "}
              {departmentName}.
            </p>
            <div className="space-y-2">
              <Label htmlFor="new-member-name">Full Name *</Label>
              <Input
                id="new-member-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. John Smith"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-member-email">Email Address *</Label>
              <Input
                id="new-member-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="e.g. john@straightdrive.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Role *</Label>
              <Select
                value={form.roleId}
                items={roles.map((r) => ({ value: r.id, label: r.name }))}
                onValueChange={(v) => setForm({ ...form, roleId: (v as string) ?? "" })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a role..." />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-member-password">Password *</Label>
              <Input
                id="new-member-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Create a strong password"
                required
              />
              <p className="text-xs text-muted-foreground">
                At least 8 characters with an uppercase letter, number, and special
                character.
              </p>
            </div>
            <div className="flex justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreating(false)}
                disabled={createLoading}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to search
              </Button>
              <Button
                type="submit"
                disabled={
                  createLoading ||
                  !form.name.trim() ||
                  !form.email.trim() ||
                  !form.password ||
                  !form.roleId
                }
                className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
              >
                {createLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create &amp; Add
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Members already in another department will be moved here.
            </p>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {filtered.length === 0 ? (
                <div className="space-y-3 py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    {candidates.length === 0
                      ? "Every active member is already in this department."
                      : "No members match your search."}
                  </p>
                  {canCreateUsers && (
                    <Button type="button" variant="outline" size="sm" onClick={startCreate}>
                      <UserPlus className="mr-2 h-4 w-4" />
                      Create a new member{search.trim() ? ` "${search.trim()}"` : ""}
                    </Button>
                  )}
                </div>
              ) : (
                filtered.map((user) => {
                  const initials = user.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2);
                  return (
                    <div
                      key={user.id}
                      className="flex items-center justify-between gap-3 rounded-lg border p-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarFallback className="bg-brand-green/10 text-xs font-semibold text-brand-green">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{user.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {user.role.name}
                            {user.department ? ` · currently in ${user.department.name}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {user.department && (
                          <Badge variant="outline" className="hidden text-[10px] sm:inline-flex">
                            {user.department.name}
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={addingId !== null}
                          onClick={() => handleAdd(user)}
                        >
                          {addingId === user.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Add"
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {canCreateUsers && filtered.length > 0 && (
              <div className="border-t pt-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={startCreate}
                >
                  <UserPlus className="mr-2 h-4 w-4" />
                  Not here? Create a new member
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
