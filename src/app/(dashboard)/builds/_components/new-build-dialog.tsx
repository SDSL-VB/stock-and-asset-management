"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getBuildableProducts, getBuildReadiness, createBuild } from "@/lib/actions/builds";
import { toast } from "sonner";
import { Plus, Search, Loader2, Hammer, AlertTriangle } from "lucide-react";

type Buildable = {
  id: string;
  code: string;
  name: string;
  kind: string;
  unit: string;
  categoryName: string;
  version: number;
  lineCount: number;
};

type ReadinessLine = {
  componentProductId: string;
  code: string;
  name: string;
  unit: string;
  needed: number;
  available: number;
  short: number;
  isOptional: boolean;
};

interface Props {
  locations: { id: string; name: string }[];
  canSetBatch: boolean;
}

function formatQty(n: number) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

/**
 * Starting a build from the Builds page.
 *
 * The Build tab on a product's own page is the natural route when you are
 * already looking at its bill of materials; this is the route when you are not,
 * which is most of the time. It picks the bill of materials first, then asks
 * the same questions.
 */
export function NewBuildDialog({ locations, canSetBatch }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const [products, setProducts] = useState<Buildable[]>([]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Buildable | null>(null);

  const [quantity, setQuantity] = useState("1");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [batch, setBatch] = useState("");
  const [notes, setNotes] = useState("");
  const [readiness, setReadiness] = useState<{
    lines: ReadinessLine[];
    canBuild: boolean;
    maxBuildable: number;
  } | null>(null);

  async function toggle(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setPicked(null);
      setReadiness(null);
      setQuantity("1");
      setBatch("");
      setNotes("");
      return;
    }
    setLoading(true);
    try {
      setProducts(await getBuildableProducts());
    } finally {
      setLoading(false);
    }
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.categoryName.toLowerCase().includes(q)
    );
  }, [products, query]);

  function check() {
    if (!picked) return;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty < 1) return toast.error("How many are you building?");
    if (!locationId) return toast.error("Pick the site building it");

    startTransition(async () => {
      const res = await getBuildReadiness(picked.id, Math.floor(qty), locationId);
      if (!res.ok) {
        setReadiness(null);
        toast.error(res.error);
        return;
      }
      setReadiness({
        lines: res.lines,
        canBuild: res.canBuild,
        maxBuildable: res.maxBuildable,
      });
    });
  }

  function build() {
    if (!picked) return;
    startTransition(async () => {
      const res = await createBuild({
        productId: picked.id,
        quantity: Math.floor(Number(quantity)),
        locationId,
        notes,
        batchNumber: batch,
      });
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Built ${quantity} × ${picked.name} as ${res.buildNumber ?? "a new build"} — now in central stock`
      );
      toggle(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={toggle}>
      <DialogTrigger render={<Button />}>
        <Plus className="mr-1.5 h-4 w-4" />
        New build
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Build from a bill of materials</DialogTitle>
          <DialogDescription>
            Components leave central stock and the assembled product arrives, ready to dispatch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!picked ? (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by product, code or category"
                  className="pl-9"
                  autoComplete="off"
                />
              </div>

              <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border p-1">
                {loading ? (
                  <p className="flex items-center justify-center gap-2 px-2 py-8 text-caption text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </p>
                ) : matches.length === 0 ? (
                  <p className="px-2 py-8 text-center text-caption text-muted-foreground">
                    {products.length === 0
                      ? "Nothing has a published bill of materials yet."
                      : "Nothing matches that search."}
                  </p>
                ) : (
                  matches.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPicked(p)}
                      className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted/60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-mono text-caption text-muted-foreground">
                            {p.code}
                          </span>
                          <span className="text-sm font-medium">{p.name}</span>
                        </span>
                        <span className="mt-0.5 block text-caption text-muted-foreground">
                          {p.categoryName} · {p.lineCount} component
                          {p.lineCount === 1 ? "" : "s"} · version {p.version}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                <div className="min-w-0">
                  <span className="font-mono text-caption text-muted-foreground">
                    {picked.code}
                  </span>{" "}
                  <span className="font-medium">{picked.name}</span>
                  <Badge variant="outline" className="ml-2 text-micro">
                    version {picked.version}
                  </Badge>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPicked(null);
                    setReadiness(null);
                  }}
                >
                  Change
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="nb-qty">How many</Label>
                  <Input
                    id="nb-qty"
                    type="number"
                    min="1"
                    step="1"
                    value={quantity}
                    onChange={(e) => {
                      setQuantity(e.target.value);
                      setReadiness(null);
                    }}
                    className="tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Built at</Label>
                  <Select
                    value={locationId}
                    items={locations.map((l) => ({ value: l.id, label: l.name }))}
                    onValueChange={(v) => {
                      setLocationId((v as string) ?? "");
                      setReadiness(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a site" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((l) => (
                        <SelectItem key={l.id} value={l.id}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {canSetBatch && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="nb-batch">Batch number</Label>
                    <Input
                      id="nb-batch"
                      value={batch}
                      onChange={(e) => setBatch(e.target.value)}
                      placeholder="Leave empty to use the build number"
                    />
                  </div>
                )}
              </div>

              {readiness && (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-micro font-bold uppercase tracking-[0.1em] text-muted-foreground">
                        <th className="px-3 py-2 text-left">Component</th>
                        <th className="px-3 py-2 text-right">Need</th>
                        <th className="px-3 py-2 text-right">Available</th>
                      </tr>
                    </thead>
                    <tbody>
                      {readiness.lines.map((l) => (
                        <tr key={l.componentProductId} className="border-b last:border-0">
                          <td className="px-3 py-2">
                            <span className="font-mono text-caption text-muted-foreground">
                              {l.code}
                            </span>{" "}
                            {l.name}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatQty(l.needed)} {l.unit}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 text-right tabular-nums",
                              l.short > 0 && !l.isOptional && "font-semibold text-destructive"
                            )}
                          >
                            {formatQty(l.available)} {l.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {readiness && !readiness.canBuild && (
                <p className="flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Not enough on hand.{" "}
                    {readiness.maxBuildable > 0
                      ? `The most you could build right now is ${readiness.maxBuildable}.`
                      : "Nothing can be built until stock arrives."}
                  </span>
                </p>
              )}

              {readiness?.canBuild && (
                <div className="space-y-1.5">
                  <Label htmlFor="nb-notes">Notes (optional)</Label>
                  <Input
                    id="nb-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Anything worth recording about this run"
                  />
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => toggle(false)} disabled={pending}>
            Cancel
          </Button>
          {picked &&
            (readiness?.canBuild ? (
              <Button onClick={build} disabled={pending}>
                {pending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Hammer className="mr-1.5 h-4 w-4" />
                )}
                Build {quantity} × {picked.name}
              </Button>
            ) : (
              <Button variant="outline" onClick={check} disabled={pending}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Check what it needs
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
