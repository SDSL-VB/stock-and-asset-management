"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createLocation, updateLocation } from "@/lib/actions/locations";

/**
 * The list of sites, with one dialog for adding and editing. A site with active
 * departments cannot be taken out of use — the server refuses it too.
 */

type Location = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  activeDepartments: number;
};

export function LocationList({
  locations,
  canCreate,
  canEdit,
}: {
  locations: Location[];
  canCreate: boolean;
  canEdit: boolean;
}) {
  // null = closed, "new" = adding, otherwise the site being edited
  const [editing, setEditing] = useState<Location | "new" | null>(null);

  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          <Button
            className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
            onClick={() => setEditing("new")}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Location
          </Button>
        </div>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Active departments</TableHead>
                <TableHead>Status</TableHead>
                {canEdit && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {locations.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell className="font-mono">{l.code}</TableCell>
                  <TableCell>{l.activeDepartments}</TableCell>
                  <TableCell>
                    <Badge variant={l.isActive ? "default" : "secondary"}>{l.isActive ? "In use" : "Retired"}</Badge>
                  </TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => setEditing(l)}>
                        <Pencil className="mr-2 h-3.5 w-3.5" />
                        Edit
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {locations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No sites yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {editing && (
        <LocationDialog
          location={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function LocationDialog({ location, onClose }: { location: Location | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(location?.name ?? "");
  const [code, setCode] = useState(location?.code ?? "");
  const [isActive, setIsActive] = useState(location?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const cannotRetire = !!location && location.isActive && location.activeDepartments > 0;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const result = location
        ? await updateLocation(location.id, { name, code, isActive })
        : await createLocation({ name, code });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(location ? "Site updated" : `Site "${name}" added`);
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
          <DialogTitle>{location ? `Edit ${location.name}` : "Add Location"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="location-name">Name</Label>
              <Input id="location-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bengaluru" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location-code">Code</Label>
              <Input
                id="location-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="BLR"
                className="font-mono"
                required
              />
            </div>
          </div>
          {location && (
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">In use</p>
                <p className="text-xs text-muted-foreground">
                  {cannotRetire
                    ? `${location.activeDepartments} active department(s) here — move or close them before retiring the site`
                    : "A retired site no longer appears in pickers"}
                </p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} disabled={cannotRetire} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {location ? "Save Changes" : "Add Location"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
