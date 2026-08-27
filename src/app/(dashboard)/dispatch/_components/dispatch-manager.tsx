"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  acceptDispatch,
  rejectDispatch,
  cancelDispatch,
  markDispatchReceived,
  lookupBatch,
  exportDispatchReport,
} from "@/lib/actions/dispatch";
import { NewDispatchDialog } from "./new-dispatch-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  Search,
  Truck,
  Building2,
  MapPin,
  Check,
  X,
  Undo2,
  Download,
} from "lucide-react";

type DispatchItem = {
  id: string;
  batchNumber: string | null;
  quantity: number;
  isAsset: boolean;
  entryId: string;
  entryNumber: string;
  itemCode: string | null;
  itemName: string;
};

type DispatchRow = {
  id: string;
  dispatchNumber: string;
  destination: "LOCATION" | "CLIENT";
  status: "PENDING" | "IN_TRANSIT" | "RECEIVED" | "REJECTED" | "CANCELLED";
  notes: string | null;
  rejectionReason: string | null;
  originLocationId: string;
  originLocationName: string;
  toLocationId: string | null;
  toLocationName: string | null;
  createdByName: string;
  acceptedByName: string | null;
  receivedByName: string | null;
  createdAt: Date;
  receivedAt: Date | null;
  client: {
    id: string;
    name: string;
    city: string;
    gstNumber: string | null;
    address: string | null;
  } | null;
  canSeeClientDetail: boolean;
  items: DispatchItem[];
};

interface Props {
  dispatches: DispatchRow[];
  stock: {
    id: string;
    locationId: string | null;
    entryNumber: string;
    itemCode: string | null;
    itemName: string;
    locationName: string | null;
    available: number;
  }[];
  locations: { id: string; name: string }[];
  clients: { id: string; name: string; city: string }[];
  myLocationId: string | null;
  canCreate?: boolean;
  canAccept?: boolean;
  canReceive?: boolean;
  seesAllLocations?: boolean;
  canExport?: boolean;
}

const STATUS_STYLES: Record<DispatchRow["status"], string> = {
  PENDING: "bg-amber-50 text-amber-800 border-amber-200",
  IN_TRANSIT: "bg-blue-50 text-blue-800 border-blue-200",
  RECEIVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  CANCELLED: "bg-gray-100 text-gray-600 border-gray-200",
};

const STATUS_LABELS: Record<DispatchRow["status"], string> = {
  PENDING: "Awaiting acceptance",
  IN_TRANSIT: "In transit",
  RECEIVED: "Received",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export function DispatchManager({
  dispatches,
  stock,
  locations,
  clients,
  myLocationId,
  canCreate = false,
  canAccept = false,
  canReceive = false,
  seesAllLocations = false,
  canExport = false,
}: Props) {
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<DispatchRow | null>(null);

  // An operator's own site is the pivot: what is leaving vs what is arriving
  const outgoing = useMemo(
    () =>
      dispatches.filter(
        (d) => seesAllLocations || d.originLocationId === myLocationId
      ),
    [dispatches, myLocationId, seesAllLocations]
  );
  const incoming = useMemo(
    () => dispatches.filter((d) => d.toLocationId && d.toLocationId === myLocationId),
    [dispatches, myLocationId]
  );
  const toClients = useMemo(
    () => dispatches.filter((d) => d.destination === "CLIENT"),
    [dispatches]
  );

  function match(list: DispatchRow[]) {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (d) =>
        d.dispatchNumber.toLowerCase().includes(q) ||
        (d.client?.name ?? "").toLowerCase().includes(q) ||
        (d.client?.city ?? "").toLowerCase().includes(q) ||
        (d.toLocationName ?? "").toLowerCase().includes(q) ||
        d.originLocationName.toLowerCase().includes(q) ||
        d.items.some(
          (i) =>
            i.itemName.toLowerCase().includes(q) ||
            (i.batchNumber ?? "").toLowerCase().includes(q)
        )
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by dispatch number, client, location, item, or batch..."
            className="pl-9"
          />
        </div>
        <BatchLookup />
        {canExport && <ExportButton />}
        {canCreate && (
          <NewDispatchDialog
            stock={stock}
            locations={locations}
            clients={clients}
            needsOriginChoice={seesAllLocations && !myLocationId}
            allLocations={locations}
            myLocationId={myLocationId}
          />
        )}
      </div>

      <Tabs defaultValue="outgoing">
        <TabsList>
          <TabsTrigger value="outgoing">
            <ArrowUpRight className="mr-2 h-4 w-4" />
            Outgoing ({outgoing.length})
          </TabsTrigger>
          <TabsTrigger value="incoming">
            <ArrowDownLeft className="mr-2 h-4 w-4" />
            Incoming ({incoming.length})
          </TabsTrigger>
          <TabsTrigger value="clients">
            <Building2 className="mr-2 h-4 w-4" />
            To Clients ({toClients.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="outgoing" className="space-y-3 pt-4">
          <DispatchCards
            rows={match(outgoing)}
            emptyMessage="Nothing has been dispatched from your location yet."
            onOpen={setDetail}
            canAccept={canAccept}
            canCreate={canCreate}
            canReceive={canReceive}
            myLocationId={myLocationId}
            seesAllLocations={seesAllLocations}
          />
        </TabsContent>
        <TabsContent value="incoming" className="space-y-3 pt-4">
          <DispatchCards
            rows={match(incoming)}
            emptyMessage="Nothing is on its way to your location."
            onOpen={setDetail}
            canAccept={canAccept}
            canCreate={canCreate}
            canReceive={canReceive}
            myLocationId={myLocationId}
            seesAllLocations={seesAllLocations}
          />
        </TabsContent>
        <TabsContent value="clients" className="space-y-3 pt-4">
          <DispatchCards
            rows={match(toClients)}
            emptyMessage="No client dispatches yet."
            onOpen={setDetail}
            canAccept={canAccept}
            canCreate={canCreate}
            canReceive={canReceive}
            myLocationId={myLocationId}
            seesAllLocations={seesAllLocations}
          />
        </TabsContent>
      </Tabs>

      <DispatchDetailDialog dispatch={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function DispatchCards({
  rows,
  emptyMessage,
  onOpen,
  canAccept,
  canCreate,
  canReceive,
  myLocationId,
  seesAllLocations,
}: {
  rows: DispatchRow[];
  emptyMessage: string;
  onOpen: (d: DispatchRow) => void;
  canAccept: boolean;
  canCreate: boolean;
  canReceive: boolean;
  myLocationId: string | null;
  seesAllLocations: boolean;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-muted-foreground">
          {emptyMessage}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {rows.map((d) => (
        <Card key={d.id}>
          <CardContent className="flex flex-wrap items-start justify-between gap-4 p-4">
            <button
              type="button"
              onClick={() => onOpen(d)}
              className="flex-1 min-w-[260px] text-left"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{d.dispatchNumber}</span>
                <Badge variant="outline" className={STATUS_STYLES[d.status]}>
                  {STATUS_LABELS[d.status]}
                </Badge>
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                {d.originLocationName}
                <span aria-hidden>→</span>
                {d.destination === "CLIENT"
                  ? `${d.client?.name ?? "Client"} (${d.client?.city ?? "—"})`
                  : d.toLocationName}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {d.items.length} line{d.items.length === 1 ? "" : "s"} ·{" "}
                {d.items.reduce((s, i) => s + i.quantity, 0)} units · raised by{" "}
                {d.createdByName}
              </p>
            </button>

            <DispatchActions
              dispatch={d}
              canAccept={canAccept}
              canCreate={canCreate}
              canReceive={canReceive}
              myLocationId={myLocationId}
              seesAllLocations={seesAllLocations}
            />
          </CardContent>
        </Card>
      ))}
    </>
  );
}

function DispatchActions({
  dispatch,
  canAccept,
  canReceive,
  canCreate,
  myLocationId,
  seesAllLocations,
}: {
  dispatch: DispatchRow;
  canAccept: boolean;
  canReceive: boolean;
  canCreate: boolean;
  myLocationId: string | null;
  seesAllLocations: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // One dialog, two acts: the destination refusing goods, and the origin
  // recalling them. They read differently and are held by different people.
  const [reasonFor, setReasonFor] = useState<"reject" | "cancel" | null>(null);
  const [reason, setReason] = useState("");

  // Only the destination end acts on a consignment
  // Someone with cross-location scope has no site of their own but may act on
  // any consignment — the server enforces the same rule.
  const isDestination =
    seesAllLocations ||
    (dispatch.destination === "CLIENT"
      ? dispatch.originLocationId === myLocationId
      : dispatch.toLocationId === myLocationId);

  const isOrigin = seesAllLocations || dispatch.originLocationId === myLocationId;
  const openStill = dispatch.status === "PENDING" || dispatch.status === "IN_TRANSIT";

  const showAccept =
    canAccept &&
    dispatch.status === "PENDING" &&
    dispatch.destination === "LOCATION" &&
    isDestination;
  const showReceive = canReceive && dispatch.status === "IN_TRANSIT" && isDestination;
  // Refusing goods that already left is the destination's call...
  const showReject =
    canAccept && dispatch.status === "IN_TRANSIT" && isDestination &&
    dispatch.destination === "LOCATION";
  // ...while withdrawing what should never have been sent is the origin's.
  // This is the only exit for a client dispatch, which nobody accepts.
  const showCancel = canCreate && openStill && isOrigin;

  async function run(fn: () => Promise<{ error?: string } | { success: boolean }>, ok: string) {
    setBusy(true);
    try {
      const result = await fn();
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(ok);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!showAccept && !showReceive && !showReject && !showCancel) return null;

  return (
    <div className="flex items-center gap-2">
      {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {showAccept && (
        <>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => run(() => acceptDispatch(dispatch.id), "Dispatch accepted — now in transit")}
            className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
          >
            <Check className="mr-1 h-4 w-4" />
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => setReasonFor("reject")}
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            <X className="mr-1 h-4 w-4" />
            Reject
          </Button>
        </>
      )}
      {showReceive && (
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            run(() => markDispatchReceived(dispatch.id), "Marked received")
          }
          className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
        >
          <Truck className="mr-1 h-4 w-4" />
          Mark Received
        </Button>
      )}
      {showReject && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setReasonFor("reject")}
          className="border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          <X className="mr-1 h-4 w-4" />
          Reject
        </Button>
      )}
      {showCancel && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setReasonFor("cancel")}
          className="text-muted-foreground hover:text-destructive"
        >
          <Undo2 className="mr-1 h-4 w-4" />
          Withdraw
        </Button>
      )}

      <Dialog open={reasonFor !== null} onOpenChange={(o) => !o && setReasonFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reasonFor === "cancel" ? "Withdraw" : "Reject"} {dispatch.dispatchNumber}
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const payload = { rejectionReason: reason.trim() };
              await run(
                () =>
                  reasonFor === "cancel"
                    ? cancelDispatch(dispatch.id, payload)
                    : rejectDispatch(dispatch.id, payload),
                reasonFor === "cancel"
                  ? "Withdrawn — the stock is back in your central stock"
                  : "Dispatch rejected — the stock returns to the origin"
              );
              setReasonFor(null);
              setReason("");
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor={`reason-${dispatch.id}`}>Reason *</Label>
              <Input
                id={`reason-${dispatch.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  reasonFor === "cancel"
                    ? "Why is this being withdrawn?"
                    : "Why is this being refused?"
                }
                required
              />
              <p className="text-xs text-muted-foreground">
                {reasonFor === "cancel"
                  ? "The quantity goes straight back into your central stock. If another site asked for this, their request goes back to waiting."
                  : "Rejecting releases the quantity back into the origin's central stock."}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setReasonFor(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={busy || reason.trim().length < 3}>
                {reasonFor === "cancel" ? "Withdraw Dispatch" : "Reject Dispatch"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DispatchDetailDialog({
  dispatch,
  onClose,
}: {
  dispatch: DispatchRow | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!dispatch} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {dispatch && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{dispatch.dispatchNumber}</span>
                <Badge variant="outline" className={STATUS_STYLES[dispatch.status]}>
                  {STATUS_LABELS[dispatch.status]}
                </Badge>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <div>
                <p className="text-muted-foreground">Route</p>
                <p className="font-medium">
                  {dispatch.originLocationName} →{" "}
                  {dispatch.destination === "CLIENT"
                    ? dispatch.client?.name
                    : dispatch.toLocationName}
                </p>
              </div>

              {/* Client detail is the Auditor's requirement: name, GST and
                  address on the particular outgoing entry. */}
              {dispatch.client && (
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="font-medium">{dispatch.client.name}</p>
                  <p className="text-muted-foreground">{dispatch.client.city}</p>
                  {dispatch.canSeeClientDetail ? (
                    <>
                      <p className="mt-2 font-mono text-xs">
                        GST: {dispatch.client.gstNumber ?? "—"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {dispatch.client.address ?? "No address on file"}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      GST and address need the client permission.
                    </p>
                  )}
                </div>
              )}

              <div>
                <p className="mb-2 text-muted-foreground">Items</p>
                <div className="space-y-2">
                  {dispatch.items.map((i) => (
                    <div key={i.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{i.itemName}</span>
                        <span className="tabular-nums">{i.quantity} units</span>
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
                        <span>{i.itemCode ?? "—"}</span>
                        {i.batchNumber ? (
                          <span className="rounded bg-brand-blue/10 px-1.5 py-0.5 text-brand-blue">
                            {i.batchNumber}
                          </span>
                        ) : (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-sans text-amber-800">
                            Batch number needed
                          </span>
                        )}
                        {i.isAsset && (
                          <span className="font-sans text-xs">· asset</span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {dispatch.notes && (
                <div>
                  <p className="text-muted-foreground">Notes</p>
                  <p>{dispatch.notes}</p>
                </div>
              )}
              {dispatch.rejectionReason && (
                <div>
                  <p className="text-muted-foreground">Rejected because</p>
                  <p className="text-destructive">{dispatch.rejectionReason}</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t pt-3 text-xs text-muted-foreground">
                <p>Raised by {dispatch.createdByName}</p>
                <p>{new Date(dispatch.createdAt).toLocaleDateString("en-IN")}</p>
                {dispatch.acceptedByName && <p>Accepted by {dispatch.acceptedByName}</p>}
                {dispatch.receivedByName && (
                  <p>
                    Received by {dispatch.receivedByName}
                    {dispatch.receivedAt
                      ? ` on ${new Date(dispatch.receivedAt).toLocaleDateString("en-IN")}`
                      : ""}
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Batch traceability: one number in, the receiving client out. */
function BatchLookup() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof lookupBatch>> | null>(
    null
  );

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      setResult(await lookupBatch(value));
    } finally {
      setLoading(false);
    }
  }

  const shipments = (result && "shipments" in result ? result.shipments : []) ?? [];

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Search className="mr-2 h-4 w-4" />
        Batch Lookup
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trace a batch number</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleLookup} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="batch-lookup">Batch number</Label>
              <div className="flex gap-2">
                <Input
                  id="batch-lookup"
                  value={value}
                  onChange={(e) => setValue(e.target.value.toUpperCase())}
                  placeholder="BATCH-20260812-0001"
                  className="font-mono"
                />
                <Button type="submit" disabled={loading || !value.trim()}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Trace
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Returns who received this item, so a recall or service visit can start
                from the number on the goods.
              </p>
            </div>

            {result && "error" in result && result.error && (
              <p className="text-sm text-destructive">{result.error}</p>
            )}

            {/* One batch legitimately ships to several customers, so a recall
                needs every consignment, not the first one found. */}
            {shipments.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm">
                  <span className="font-mono font-semibold">{value.trim()}</span> went out on{" "}
                  <strong>{shipments.length}</strong> consignment
                  {shipments.length === 1 ? "" : "s"}.
                </p>
                {shipments.map((b) => (
                  <div key={b.dispatchNumber} className="space-y-3 rounded-lg border p-3 text-sm">
                    <div>
                      <p className="font-medium">{b.itemName}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {b.itemCode ?? "—"} · {b.quantity} units
                        {b.isAsset ? " · asset" : ""}
                      </p>
                    </div>
                    <div className={cn("rounded-md p-2", "bg-muted/50")}>
                      <p className="text-xs text-muted-foreground">Went to</p>
                      {b.client ? (
                        <>
                          <p className="font-medium">{b.client.name}</p>
                          <p className="text-xs text-muted-foreground">{b.client.city}</p>
                          {b.client.gstNumber && (
                            <p className="mt-1 font-mono text-xs">GST: {b.client.gstNumber}</p>
                          )}
                          {b.client.address && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {b.client.address}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="font-medium">{b.toLocationName}</p>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Dispatch {b.dispatchNumber} from {b.originLocationName} ·{" "}
                      {STATUS_LABELS[b.status as DispatchRow["status"]]}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}


/** Downloads the dispatch report. Rendered only for holders of dispatch.export. */
function ExportButton() {
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    try {
      const result = await exportDispatchReport();
      if ("error" in result) {
        toast.error(result.error as string);
        return;
      }
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dispatches-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        `Exported ${result.rowCount} line${result.rowCount === 1 ? "" : "s"}`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" onClick={handleExport} disabled={busy}>
      {busy ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Download className="mr-2 h-4 w-4" />
      )}
      Export
    </Button>
  );
}
