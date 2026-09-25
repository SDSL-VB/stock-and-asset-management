"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BellRing,
  ChevronDown,
  ChevronRight,
  Layers,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProductCombobox, type ProductOption } from "@/components/shared/product-combobox";
import { toneStyles } from "@/lib/design/status";
import { removeStockLevel, saveStockLevel, updateWatchesFromBoms } from "@/lib/actions/low-stock";
import { NeedDialog, type NeedPrefill, type NeedProduct } from "@/components/shared/need-dialog";
import { SuppliersDialog } from "@/components/shared/suppliers-dialog";
import { formatDateTime } from "@/lib/format";
import type { StockLevelRow } from "@/lib/low-stock";

/**
 * The low-stock alert, and the settings behind it — on the Procurement page,
 * because running low is a reason to buy.
 *
 * Each watched product at each site, most urgent first, in three states:
 *
 *   Order now     low, and what is already coming does not close the gap.
 *                 These are what the bell in the top bar counts.
 *   Low, coming   low, but needs or orders already on the way cover it
 *   OK            above its reorder point; "order in ~N days" when there is a
 *                 pace of use to project from
 *
 A low item says WHEN it went low and which movement took it there, so
 * whoever gets the alert can see how long it has been waiting.
 *
 * "Raise needs" opens the "What do you need?" dialog filled in with every
 * "order now" item at that site — the suggested quantity and the preferred
 * vendor — for the person to check, date and send as one need request.
 *
 * Within a site the components are grouped by the BILL OF MATERIALS they are
 * watched for, so a Machine Power Component and a BLDC panel are two things to
 * read rather than thirty loose parts. Each group opens to its components.
 * Products watched by hand are not part of any BOM and are listed on their own
 * at the end.
 *
 * The reorder point is daily use × lead time + minimum; src/lib/low-stock.ts
 * holds the rule. A product with no use yet reorders at its minimum alone.
 * Watches come two ways. Every component of a published BOM is watched
 * automatically at the sites that build it, with a minimum of N builds' worth
 * (N is set on the BOM) — tagged "From BOM" here; src/lib/low-stock-bom.ts
 * keeps them current. Anything else is watched by hand. Editing an automatic
 * watch's minimum makes it a manual one, and stopping one keeps it stopped.
 *
 * Watching sets only the minimum: the vendor and lead time are the product's
 * supplier records (the "Lead times" button), the same ones Vendors and the Catalog
 * edit, so there is one lead time per product–vendor pair and not a copy here.
 *
 * Who sees what: the panel needs stock.lowstock.view, "Raise needs" also needs
 * procurement.intent.create, and the watch / edit / stop controls need
 * stock.lowstock.manage. Anything the viewer cannot do is simply absent.
 */

type FormData = {
  products: (ProductOption & { unit: string })[];
  locations: { id: string; name: string }[];
};

type NeedForm = {
  products: NeedProduct[];
  vendors: { id: string; name: string }[];
  locations: { id: string; name: string }[];
};

function qty(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** "Low since 18 Sep 2026, 14:32 — Dispatch DSP-0012 took 5" */
function LowSince({ row }: { row: StockLevelRow }) {
  if (!row.lowSince) return null;
  return (
    <p className="text-micro text-muted-foreground">
      Low since {formatDateTime(row.lowSince.at)} — {row.lowSince.cause}
    </p>
  );
}

function StatusCell({ row }: { row: StockLevelRow }) {
  if (row.needsAction) {
    return (
      <div className="space-y-0.5">
        <Badge variant="outline" className={toneStyles("rejected").pill}>Order now</Badge>
        <LowSince row={row} />
        <p className="text-micro text-muted-foreground">
          {row.runsOutInDays !== null ? `Runs out in ~${row.runsOutInDays} days. ` : ""}
          Ask for {qty(row.suggestedQuantity)} {row.unit}
        </p>
      </div>
    );
  }
  if (row.isLow) {
    return (
      <div className="space-y-0.5">
        <Badge variant="outline" className={toneStyles("pending").pill}>Low — covered</Badge>
        <LowSince row={row} />
        <p className="text-micro text-muted-foreground">{qty(row.onTheWay)} {row.unit} on the way</p>
      </div>
    );
  }
  return (
    <div className="space-y-0.5">
      <Badge variant="outline" className={toneStyles("approved").pill}>OK</Badge>
      {row.orderInDays !== null && (
        <p className="text-micro text-muted-foreground">Order in ~{row.orderInDays} days</p>
      )}
    </div>
  );
}

function WatchDialog({
  open,
  onOpenChange,
  form,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: FormData;
  editing: StockLevelRow | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [productId, setProductId] = useState(editing?.productId ?? "");
  const [locationId, setLocationId] = useState(editing?.locationId ?? form.locations[0]?.id ?? "");
  const [minimum, setMinimum] = useState(editing ? String(editing.minimum) : "");

  const product = form.products.find((p) => p.id === productId);

  function save() {
    startTransition(async () => {
      const res = await saveStockLevel({
        productId,
        locationId,
        minimum: Number(minimum),
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(editing ? "Updated" : `Now watching ${product?.name ?? "it"}`);
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `${editing.name} at ${editing.locationName}` : "Watch a product"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!editing && (
            <>
              <div className="space-y-2">
                <Label>Product</Label>
                <ProductCombobox products={form.products} value={productId} onChange={setProductId} />
              </div>
              <div className="space-y-2">
                <Label>Site</Label>
                <Select
                  value={locationId}
                  items={form.locations.map((l) => ({ value: l.id, label: l.name }))}
                  onValueChange={(v) => setLocationId((v as string) ?? "")}
                >
                  <SelectTrigger><SelectValue placeholder="Pick a site" /></SelectTrigger>
                  <SelectContent>
                    {form.locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="ls-min">Minimum to keep at this site</Label>
            <Input id="ls-min" type="number" min="0" step="any" value={minimum} onChange={(e) => setMinimum(e.target.value)} className="max-w-[180px]" />
            <p className="text-xs text-muted-foreground">
              Never fall below this. With no use recorded yet, it is also the reorder point.
            </p>
            {editing?.fromBom && (
              <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
                This minimum comes from the product&apos;s BOM (enough for its set number of builds).
                Saving a different one here makes it yours — the BOM will not change it again.
              </p>
            )}
          </div>

          <div className="flex items-start gap-3 rounded-md border p-3">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium">Who supplies it, and how fast</p>
              {editing?.vendor ? (
                <p className="text-sm">
                  {editing.vendor.name} · {editing.leadTimeDays} day{editing.leadTimeDays === 1 ? "" : "s"}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{editing ? "No supplier recorded yet" : "Pick a product first"}</p>
              )}
              <p className="text-xs text-muted-foreground">
                The lead time — days from ordering to arrival — moves the alert
                earlier, so an order placed on time lands before the shelf is
                empty. It belongs to the product and vendor together; the same
                record shows on Vendors and in the Catalog.
              </p>
            </div>
            {product && <SuppliersDialog side={{ kind: "product", id: product.id, name: product.name }} canEdit />}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={pending || !productId || !locationId || minimum === ""}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One bill of materials' components at one site, or the hand-watched ones.
 *
 * Grouped by the BOM each component is watched FOR, which is the one whose
 * requirement set its minimum (src/lib/low-stock-bom.ts) — so a component used
 * by two products appears once, under the product that needs the most of it.
 */
type LowStockGroup = {
  key: string;
  /** Null for the "watched by hand" group, which is nobody's BOM */
  bomProductName: string | null;
  rows: StockLevelRow[];
  toOrder: number;
};

function groupByBom(locationId: string, rows: StockLevelRow[]): LowStockGroup[] {
  const byBom = new Map<string, LowStockGroup>();
  const byHand: StockLevelRow[] = [];

  for (const row of rows) {
    if (!row.bom) {
      byHand.push(row);
      continue;
    }
    const key = `${locationId}:${row.bom.id}`;
    const group = byBom.get(key) ?? { key, bomProductName: row.bom.productName, rows: [], toOrder: 0 };
    group.rows.push(row);
    byBom.set(key, group);
  }

  const groups = [...byBom.values()].sort((a, b) =>
    (a.bomProductName ?? "").localeCompare(b.bomProductName ?? "")
  );
  if (byHand.length > 0) {
    groups.push({ key: `${locationId}:by-hand`, bomProductName: null, rows: byHand, toOrder: 0 });
  }
  for (const group of groups) group.toOrder = group.rows.filter((r) => r.needsAction).length;
  // Whatever needs ordering first, so the urgent group is at the top
  return groups.sort((a, b) => b.toOrder - a.toOrder);
}

export function LowStockPanel({
  rows,
  form,
  canManage,
  needForm,
}: {
  rows: StockLevelRow[];
  /** Null unless the viewer holds stock.lowstock.manage */
  form: FormData | null;
  canManage: boolean;
  /** Null unless the viewer holds procurement.intent.create */
  needForm: NeedForm | null;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ editing: StockLevelRow | null } | null>(null);
  const [asking, setAsking] = useState<NeedPrefill | null>(null);
  const [syncing, startSync] = useTransition();
  // Which BOM groups are open. Collapsed to start: the header already says how
  // many of its components need ordering, so nothing urgent is hidden.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // One block per site: the alert is per site, and so is raising needs. Within
  // it, one group per bill of materials, then whatever is watched by hand.
  const sites = useMemo(() => {
    const bySite = new Map<string, { name: string; rows: StockLevelRow[]; groups: LowStockGroup[] }>();
    for (const r of rows) {
      const site = bySite.get(r.locationId) ?? { name: r.locationName, rows: [], groups: [] };
      site.rows.push(r);
      bySite.set(r.locationId, site);
    }
    for (const [locationId, site] of bySite) site.groups = groupByBom(locationId, site.rows);
    return [...bySite.entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name));
  }, [rows]);

  const actionCount = rows.filter((r) => r.needsAction).length;

  return (
    <Card id="low-stock">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="h-4 w-4" />
            Low stock
            {actionCount > 0 && (
              <Badge variant="outline" className={toneStyles("rejected").pill}>{actionCount} to order</Badge>
            )}
          </CardTitle>
          <p className="mt-1 text-caption text-muted-foreground">
            Reorder point = daily use × vendor lead time + minimum. Worked out from
            stock as it stands now, per site. Every BOM component is watched
            automatically at the sites that build it.
          </p>
        </div>
        {canManage && form && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={syncing}
              onClick={() =>
                startSync(async () => {
                  const res = await updateWatchesFromBoms();
                  toast.success(
                    res.added + res.updated + res.removed === 0
                      ? "Already up to date with the BOMs"
                      : `From BOMs: ${res.added} added, ${res.updated} updated, ${res.removed} removed`
                  );
                  router.refresh();
                })
              }
            >
              {syncing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
              Update from BOMs
            </Button>
            <Button size="sm" onClick={() => setDialog({ editing: null })}>
              <Plus className="mr-1.5 h-4 w-4" />
              Watch a product
            </Button>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing is being watched yet. {canManage ? "Set a minimum for a product at a site and it will appear here." : ""}
          </p>
        )}

        {sites.map(([locationId, site]) => {
          const toOrder = site.rows.filter((r) => r.needsAction).length;
          return (
            <section key={locationId} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{site.name}</h3>
                {needForm && toOrder > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setAsking({
                        reason: `Running low at ${site.name}`,
                        locationId,
                        lines: site.rows
                          .filter((r) => r.needsAction)
                          .map((r) => ({ productId: r.productId, quantity: r.suggestedQuantity })),
                        source: { kind: "LOW_STOCK" },
                      })
                    }
                  >
                    Raise needs for {toOrder} item{toOrder === 1 ? "" : "s"}
                  </Button>
                )}
              </div>

              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-caption text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Product</th>
                      <th className="px-3 py-2 text-right font-medium">Available</th>
                      <th className="px-3 py-2 text-right font-medium">Reorder at</th>
                      <th className="px-3 py-2 text-right font-medium">Use / day</th>
                      <th className="px-3 py-2 font-medium">Vendor · lead time</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      {canManage && <th className="w-20 px-3 py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {site.groups.map((group) => {
                      const open = openGroups.has(group.key);
                      const columns = canManage ? 7 : 6;
                      return (
                        <Fragment key={group.key}>
                          {/* The bill of materials this lot is watched for.
                              Click it to see the components. */}
                          <tr className="border-t bg-muted/30">
                            <td colSpan={columns} className="px-0 py-0">
                              <button
                                type="button"
                                onClick={() => toggleGroup(group.key)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/60"
                              >
                                {open ? (
                                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="text-sm font-medium">
                                    {group.bomProductName ?? "Watched by hand"}
                                  </span>
                                  <span className="ml-1.5 text-micro text-muted-foreground">
                                    {group.bomProductName
                                      ? `${group.rows.length} component${group.rows.length === 1 ? "" : "s"}`
                                      : `${group.rows.length} product${group.rows.length === 1 ? "" : "s"}`}
                                  </span>
                                </span>
                                {group.toOrder > 0 && (
                                  <Badge variant="outline" className={toneStyles("rejected").pill}>
                                    {group.toOrder} to order
                                  </Badge>
                                )}
                              </button>
                            </td>
                          </tr>

                          {open &&
                            group.rows.map((r) => (
                              <tr key={r.stockLevelId} className="border-t align-top">
                                <td className="px-3 py-2">
                                  <span className="font-mono text-xs text-muted-foreground">{r.code}</span>{" "}
                                  {r.name}
                                  {r.fromBom && (
                                    <Badge variant="outline" className="ml-1.5 gap-1 text-micro" title="Watched because it is in a BOM">
                                      <Layers className="h-3 w-3" />
                                      From BOM
                                    </Badge>
                                  )}
                                  {r.description && <span className="block text-micro text-muted-foreground">{r.description}</span>}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">{qty(r.available)} {r.unit}</td>
                                <td className="px-3 py-2 text-right tabular-nums">
                                  {qty(r.reorderPoint)}
                                  <span className="block text-micro text-muted-foreground">min {qty(r.minimum)}</span>
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums">
                                  {r.dailyUse === null ? <span className="text-micro text-muted-foreground">no use yet</span> : qty(r.dailyUse)}
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex items-start gap-1">
                                    <div className="min-w-0 flex-1">
                                      {r.vendor ? (
                                        <>
                                          {r.vendor.name}
                                          <span className="block text-micro text-muted-foreground">{r.leadTimeDays} days</span>
                                        </>
                                      ) : (
                                        <span className="text-micro text-muted-foreground">not recorded</span>
                                      )}
                                    </div>
                                    <SuppliersDialog side={{ kind: "product", id: r.productId, name: r.name }} canEdit={canManage} />
                                  </div>
                                </td>
                                <td className="px-3 py-2"><StatusCell row={r} /></td>
                                {canManage && (
                                  <td className="px-3 py-2">
                                    <div className="flex justify-end gap-1">
                                      <Button variant="ghost" size="sm" aria-label="Edit" onClick={() => setDialog({ editing: r })}>
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        aria-label="Stop watching"
                                        onClick={async () => {
                                          const res = await removeStockLevel(r.stockLevelId);
                                          if ("error" in res) return toast.error(res.error);
                                          toast.success(`Stopped watching ${r.name} at ${r.locationName}`);
                                          router.refresh();
                                        }}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </CardContent>

      {dialog && form && (
        <WatchDialog
          key={dialog.editing?.stockLevelId ?? "new"}
          open
          onOpenChange={(o) => !o && setDialog(null)}
          form={form}
          editing={dialog.editing}
        />
      )}

      {asking && needForm && (
        <NeedDialog {...needForm} open onOpenChange={(o) => !o && setAsking(null)} prefill={asking} />
      )}
    </Card>
  );
}
