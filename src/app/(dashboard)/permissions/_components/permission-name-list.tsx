"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { renamePermission } from "@/lib/actions/permission-names";

/**
 * Every permission, grouped by module and searchable, each with an Edit button.
 * The key is shown but never editable — it is what the code checks.
 */

type Permission = { id: string; key: string; name: string; description: string | null; module: string };

export function PermissionNameList({ permissions }: { permissions: Permission[] }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Permission | null>(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = q
      ? permissions.filter((p) => [p.key, p.name, p.description ?? "", p.module].some((t) => t.toLowerCase().includes(q)))
      : permissions;
    const byModule = new Map<string, Permission[]>();
    for (const p of shown) byModule.set(p.module, [...(byModule.get(p.module) ?? []), p]);
    return [...byModule.entries()];
  }, [permissions, query]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, key or description"
          className="pl-9"
        />
      </div>
      {groups.length === 0 && <p className="text-sm text-muted-foreground">Nothing matches that search.</p>}
      {groups.map(([module, items]) => (
        <Card key={module}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold capitalize">{module}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {items.map((p) => (
              <div key={p.id} className="flex items-start justify-between gap-4 px-6 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{p.name}</p>
                  {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">{p.key}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setEditing(p)}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Edit
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      {editing && <RenameDialog permission={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RenameDialog({ permission, onClose }: { permission: Permission; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(permission.name);
  const [description, setDescription] = useState(permission.description ?? "");
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await renamePermission(permission.id, { name, description });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved — the new wording shows everywhere");
      onClose();
      router.refresh();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit permission</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="permission-name">Name</Label>
              <Input id="permission-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Key (fixed)</Label>
              <Input value={permission.key} disabled className="font-mono" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="permission-description">Description</Label>
            <Textarea
              id="permission-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="What someone holding this can do"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
