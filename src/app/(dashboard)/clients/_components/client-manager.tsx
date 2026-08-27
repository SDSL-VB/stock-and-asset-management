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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createClient,
  updateClient,
  toggleClientActive,
  deleteClient,
  exportClients,
} from "@/lib/actions/clients";
import { ExportButton } from "@/components/shared/export-button";
import { SafeDeleteButton } from "@/components/shared/safe-delete-button";
import { toast } from "sonner";
import { Plus, Loader2, Pencil, Search, MapPin } from "lucide-react";

type Client = {
  id: string;
  name: string;
  city: string;
  gstNumber: string | null;
  address: string | null;
  isActive: boolean;
  _count: { stockEntries: number };
};

interface Props {
  clients: Client[];
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canExport?: boolean;
}

export function ClientManager({
  clients,
  canExport = false,
  canCreate = false,
  canEdit = false,
  canDelete = false,
}: Props) {
  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState("all");

  // The spec's requirement: find a client by name or by the city they sit in
  const cities = useMemo(
    () => [...new Set(clients.map((c) => c.city))].sort(),
    [clients]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (cityFilter !== "all" && c.city !== cityFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        (c.gstNumber ?? "").toLowerCase().includes(q) ||
        (c.address ?? "").toLowerCase().includes(q)
      );
    });
  }, [clients, search, cityFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, city, GST, or address..."
            className="pl-9"
          />
        </div>
        <Select
          value={cityFilter}
          items={[
            { value: "all", label: "All cities" },
            ...cities.map((c) => ({ value: c, label: c })),
          ]}
          onValueChange={(v) => setCityFilter((v as string) ?? "all")}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All cities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All cities</SelectItem>
            {cities.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canExport && (
          <ExportButton
            action={exportClients}
            fileName="clients"
            noun="client"
            label="Export list"
          />
        )}
        {canCreate && <ClientDialog />}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>City</TableHead>
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
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      {clients.length === 0
                        ? "No clients yet. Add the first one."
                        : "No clients match your search."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm">
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                          {c.city}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {c.gstNumber ?? <span className="text-muted-foreground font-sans">—</span>}
                      </TableCell>
                      <TableCell className="max-w-[260px] text-sm text-muted-foreground">
                        {c.address ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {c._count.stockEntries}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            c.isActive
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-gray-100 text-gray-600 border-gray-200"
                          }
                        >
                          {c.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {canEdit && (
                            <>
                              <ClientDialog client={c} />
                              <ToggleActiveButton client={c} />
                            </>
                          )}
                          {canDelete && (
                            <SafeDeleteButton
                              compact
                              name={c.name}
                              onDelete={(o) => deleteClient(c.id, o)}
                              onDeactivate={
                                c.isActive ? () => toggleClientActive(c.id) : undefined
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

function ToggleActiveButton({ client }: { client: Client }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleToggle() {
    setLoading(true);
    try {
      const result = await toggleClientActive(client.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(client.isActive ? "Client deactivated" : "Client activated");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" disabled={loading} onClick={handleToggle}>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : client.isActive ? (
        "Deactivate"
      ) : (
        "Activate"
      )}
    </Button>
  );
}

function ClientDialog({ client }: { client?: Client }) {
  const router = useRouter();
  const isEditing = !!client;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(client?.name ?? "");
  const [city, setCity] = useState(client?.city ?? "");
  const [gstNumber, setGstNumber] = useState(client?.gstNumber ?? "");
  const [address, setAddress] = useState(client?.address ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        name: name.trim(),
        city: city.trim(),
        gstNumber: gstNumber.trim(),
        address: address.trim(),
      };
      const result = isEditing
        ? await updateClient(client.id, payload)
        : await createClient(payload);

      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(isEditing ? "Client updated" : `Client "${name.trim()}" added`);
      setOpen(false);
      if (!isEditing) {
        setName("");
        setCity("");
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
          Add Client
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? `Edit ${client.name}` : "Add Client"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="client-name">Client Name *</Label>
            <Input
              id="client-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. TimeZone"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="client-city">City *</Label>
            <Input
              id="client-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Delhi"
              required
            />
            <p className="text-xs text-muted-foreground">
              Outgoing stock is filtered by this.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="client-gst">GST Number</Label>
            <Input
              id="client-gst"
              value={gstNumber}
              onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
              placeholder="29ABCDE1234F1Z5"
              className="font-mono"
              maxLength={15}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="client-address">Address</Label>
            <Textarea
              id="client-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Full delivery address"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !name.trim() || !city.trim()}
              className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Add Client"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
