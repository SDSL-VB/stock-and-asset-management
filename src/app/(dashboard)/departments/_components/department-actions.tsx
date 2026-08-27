"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  updateDepartment,
  deleteDepartment,
  toggleDepartmentStatus,
} from "@/lib/actions/departments";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, MoreVertical, Pencil, Power, Trash2 } from "lucide-react";

interface Department {
  id: string;
  name: string;
  description: string | null;
  locationId?: string | null;
  location?: { id: string; name: string } | null;
  isActive: boolean;
  _count: { users: number };
}

interface Props {
  department: Department;
  canEdit: boolean;
  canDelete: boolean;
  locations?: { id: string; name: string }[];
}

export function DepartmentActions({ department, canEdit, canDelete, locations = [] }: Props) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(department.name);
  const [description, setDescription] = useState(department.description ?? "");
  const [locationId, setLocationId] = useState(department.locationId ?? "");

  if (!canEdit && !canDelete) return null;

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await updateDepartment(department.id, {
        name: name.trim(),
        description: description.trim(),
        locationId: locationId || undefined,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Department updated");
      setEditOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle() {
    const result = await toggleDepartmentStatus(department.id);
    if ("error" in result && result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(department.isActive ? "Department deactivated" : "Department activated");
    router.refresh();
  }

  async function handleDelete() {
    setSaving(true);
    try {
      const result = await deleteDepartment(department.id);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Department "${department.name}" deleted`);
      setDeleteOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="sm" aria-label="Department actions" />}
        >
          <MoreVertical className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && (
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              <DropdownMenuItem onClick={handleToggle}>
                <Power className="mr-2 h-4 w-4" />
                {department.isActive ? "Deactivate" : "Activate"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Department</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`dept-edit-name-${department.id}`}>Department Name</Label>
              <Input
                id={`dept-edit-name-${department.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Select
                value={locationId}
                items={locations.map((l) => ({ value: l.id, label: l.name }))}
                onValueChange={(v) => setLocationId((v as string) ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Members inherit their location from this department.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`dept-edit-desc-${department.id}`}>Description (optional)</Label>
              <Textarea
                id={`dept-edit-desc-${department.id}`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving || !name.trim()}
                className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Department</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Permanently delete <span className="font-semibold">{department.name}</span>?
              This cannot be undone. Deletion is blocked while members, stock entries, or
              transfers still reference this department — deactivate it instead if you
              want to keep the history.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={saving} onClick={handleDelete}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Delete Department
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
