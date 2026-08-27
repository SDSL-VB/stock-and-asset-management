"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createVendor,
  updateVendor,
  toggleVendorActive,
  deleteVendor,
  exportVendors,
} from "@/lib/actions/vendors";
import { SafeDeleteButton } from "@/components/shared/safe-delete-button";
import { ExportButton } from "@/components/shared/export-button";
import { toast } from "sonner";
import { Plus, Loader2, Pencil, Search } from "lucide-react";

type Vendor = {
  id: string;
  name: string;
  gstNumber: string | null;
  address: string | null;
  isActive: boolean;
  _count: { stockEntries: number };
};

interface Props {
  vendors: Vendor[];
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canExport?: boolean;
}

export function VendorManager({
  vendors,
  canCreate = false,
  canEdit = false,
  canDelete = false,
  canExport = false,
}: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.gstNumber ?? "").toLowerCase().includes(q) ||
        (v.address ?? "").toLowerCase().includes(q)
    );
  }, [vendors, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, GST, or address..."
            className="pl-9"
          />
        </div>
        {canExport && (
          <ExportButton
            action={exportVendors}
            fileName="vendors"
            noun="vendor"
            label="Export list"
          />
        )}
        {canCreate && <VendorDialog />}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>GST Number</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[120px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      {vendors.length === 0
                        ? "No vendors yet. Add the first one."
                        : "No vendors match your search."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-medium">{v.name}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {v.gstNumber ?? <span className="text-muted-foreground font-sans">—</span>}
                      </TableCell>
                      <TableCell className="max-w-[280px] text-sm text-muted-foreground">
                        {v.address ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {v._count.stockEntries}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            v.isActive
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-gray-100 text-gray-600 border-gray-200"
                          }
                        >
                          {v.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {canEdit && (
                            <>
                              <VendorDialog vendor={v} />
                              <ToggleActiveButton vendor={v} />
                            </>
                          )}
                          {canDelete && (
                            <SafeDeleteButton
                              compact
                              name={v.name}
                              onDelete={(o) => deleteVendor(v.id, o)}
                              onDeactivate={
                                v.isActive ? () => toggleVendorActive(v.id) : undefined
                              }
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ToggleActiveButton({ vendor }: { vendor: Vendor }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleToggle() {
    setLoading(true);
    try {
      const result = await toggleVendorActive(vendor.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(vendor.isActive ? "Vendor deactivated" : "Vendor activated");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" disabled={loading} onClick={handleToggle}>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : vendor.isActive ? (
        "Deactivate"
      ) : (
        "Activate"
      )}
    </Button>
  );
}

function VendorDialog({ vendor }: { vendor?: Vendor }) {
  const router = useRouter();
  const isEditing = !!vendor;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(vendor?.name ?? "");
  const [gstNumber, setGstNumber] = useState(vendor?.gstNumber ?? "");
  const [address, setAddress] = useState(vendor?.address ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        name: name.trim(),
        gstNumber: gstNumber.trim(),
        address: address.trim(),
      };
      const result = isEditing
        ? await updateVendor(vendor.id, payload)
        : await createVendor(payload);

      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(isEditing ? "Vendor updated" : `Vendor "${name.trim()}" added`);
      setOpen(false);
      if (!isEditing) {
        setName("");
        setGstNumber("");
        setAddress("");
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {isEditing ? (
        <DialogTrigger render={<Button variant="ghost" size="sm" />}>
          <Pencil className="h-4 w-4" />
        </DialogTrigger>
      ) : (
        <DialogTrigger
          render={
            <Button className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold" />
          }
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Vendor
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? `Edit ${vendor.name}` : "Add Vendor"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vendor-name">Vendor Name *</Label>
            <Input
              id="vendor-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. TCL Televisions"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vendor-gst">GST Number</Label>
            <Input
              id="vendor-gst"
              value={gstNumber}
              onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
              placeholder="29ABCDE1234F1Z5"
              className="font-mono"
              maxLength={15}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vendor-address">Address</Label>
            <Textarea
              id="vendor-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Registered address"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !name.trim()}
              className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Add Vendor"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
