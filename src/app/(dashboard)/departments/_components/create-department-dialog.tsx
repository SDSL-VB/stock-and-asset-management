"use client";

import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createDepartment } from "@/lib/actions/departments";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";

export function CreateDepartmentDialog({
  locations = [],
}: {
  locations?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [locationId, setLocationId] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await createDepartment({ name, description, locationId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Department "${name}" created successfully!`);
      setOpen(false);
      setName("");
      setDescription("");
      setLocationId("");
      router.refresh();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold" />}>
        <Plus className="mr-2 h-4 w-4" />
        Add Department
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Department</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dept-name">Department Name</Label>
            <Input
              id="dept-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Marketing"
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
              Members inherit their location from the department they belong to.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dept-desc">Description (optional)</Label>
            <Textarea
              id="dept-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this department do?"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !name.trim()}
              className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Department
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
