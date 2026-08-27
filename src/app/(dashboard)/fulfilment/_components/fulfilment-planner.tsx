"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { getFulfilmentPlan, createSiteRequest } from "@/lib/actions/fulfilment";
import { toast } from "sonner";
import {
  Search,
  Check,
  Loader2,
  CircleAlert,
  Hammer,
  Truck,
  PackageCheck,
  ArrowRight,
} from "lucide-react";

type Product = {
  id: string;
  code: string;
  name: string;
  unit: string;
  kind: string;
  categoryName: string;
  hasBom: boolean;
};

type Site = {
  locationId: string;
  locationName: string;
  available: number;
  buildable: number;
};

type Plan = {
  product: { id: string; code: string; name: string; unit: string; hasBom: boolean };
  wanted: number;
  sites: Site[];
  totalAvailable: number;
  totalBuildable: number;
  shortAfterStock: number;
  shortAfterBuilding: number;
  coveredByStock: boolean;
  coveredWithBuilding: boolean;
  moves: { locationId: string; locationName: string; quantity: number }[];
  singleSite: string | null;
  /** The viewer's own site — you never ask it for what is already there */
  viewerLocationId: string | null;
  availableHere: number;
};

interface Props {
  products: Product[];
  canRequest: boolean;
  /**
   * Sites the person may request *for*. Empty when they belong to one, because
   * then there is nothing to choose.
   */
  destinations: { id: string; name: string }[];
}

function formatQty(n: number) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

/**
 * "Can we supply this, and from where?"
 *
 * The answer is a sentence, not a table — so the verdict leads, and the
 * per-site breakdown sits underneath for whoever needs to act on it.
 */
export function FulfilmentPlanner({ products, canRequest, destinations }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [checking, setChecking] = useState(false);

  // Asking another site
  const [askSite, setAskSite] = useState<Site | null>(null);
  const [askQty, setAskQty] = useState("1");
  const [askNotes, setAskNotes] = useState("");
  const [askFor, setAskFor] = useState("");
  const [saving, startSaving] = useTransition();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products.slice(0, 8);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.code.toLowerCase().includes(q) ||
          p.categoryName.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [products, query]);

  async function check(product: Product, qty: string) {
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter how many you need");
      return;
    }
    setChecking(true);
    try {
      const result = await getFulfilmentPlan(product.id, n);
      if (!result.ok) {
        toast.error(result.error);
        setPlan(null);
        return;
      }
      setPlan(result);
    } finally {
      setChecking(false);
    }
  }

  function pick(product: Product) {
    setPicked(product);
    setQuery("");
    void check(product, quantity);
  }

  function openAsk(site: Site) {
    setAskSite(site);
    // Default to what is actually missing, capped at what they can spare
    const gap = plan ? Math.max(1, Math.ceil(plan.shortAfterStock || plan.wanted)) : 1;
    setAskQty(String(Math.min(gap, Math.floor(site.available)) || 1));
    setAskNotes("");
    // Default to the first site that is not the one being asked
    setAskFor(destinations.find((d) => d.id !== site.locationId)?.id ?? "");
  }

  // Only a cross-site user has a choice to make here; everyone else is asking
  // on behalf of the site they belong to.
  const askForOptions = askSite
    ? destinations.filter((d) => d.id !== askSite.locationId)
    : [];

  function submitAsk() {
    if (!askSite || !plan) return;
    startSaving(async () => {
      const result = await createSiteRequest({
        productId: plan.product.id,
        fromLocationId: askSite.locationId,
        quantity: Number(askQty),
        notes: askNotes,
        toLocationId: askFor || undefined,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Asked ${askSite.locationName} for ${askQty} × ${plan.product.name}`);
      setAskSite(null);
      router.refresh();
    });
  }

  if (products.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nothing to check yet — fulfilment reads approved stock and published bills of
          materials, and there are none of either.
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Can we supply this?</CardTitle>
          <CardDescription>
            Pick what is being asked for and how many. Every site is checked at once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="fulfilment-product">Product</Label>
              {picked ? (
                <div className="flex min-w-0 items-center gap-2 rounded-md border border-border px-3 py-2">
                  <Check className="size-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-medium">{picked.name}</span>{" "}
                    <span className="text-muted-foreground">({picked.code})</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPicked(null);
                      setPlan(null);
                    }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="fulfilment-product"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name, code or category"
                    className="pl-9"
                  />
                </div>
              )}
            </div>

            <div className="w-full space-y-2 sm:w-32">
              <Label htmlFor="fulfilment-qty">How many</Label>
              <Input
                id="fulfilment-qty"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>

            <Button
              onClick={() => picked && check(picked, quantity)}
              disabled={!picked || checking}
            >
              {checking ? <Loader2 className="size-4 animate-spin" /> : null}
              Check
            </Button>
          </div>

          {!picked && (
            <div className="divide-y divide-border rounded-md border border-border">
              {matches.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  Nothing matches “{query}”.
                </p>
              ) : (
                matches.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pick(p)}
                    className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <span className="font-medium">{p.name}</span>{" "}
                      <span className="text-muted-foreground">{p.code}</span>
                    </span>
                    {p.hasBom && (
                      <Badge variant="outline" className="shrink-0 gap-1">
                        <Hammer className="size-3" />
                        Can be built
                      </Badge>
                    )}
                  </button>
                ))
              )}
            </div>
          )}

          {plan && <Verdict plan={plan} />}
        </CardContent>
      </Card>

      {plan && (
        <Card>
          <CardHeader>
            <CardTitle>Where it is</CardTitle>
            <CardDescription>
              Uncommitted central stock at each site, and what each could build from
              components it already holds.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Site</TableHead>
                  <TableHead className="text-right">On the shelf</TableHead>
                  <TableHead className="text-right">Could build</TableHead>
                  {canRequest && <TableHead className="text-right">Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.sites.map((site) => (
                  <TableRow key={site.locationId}>
                    <TableCell className="font-medium">{site.locationName}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {site.available > 0 ? (
                        formatQty(site.available)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {site.buildable > 0 ? (
                        formatQty(site.buildable)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {canRequest && (
                      <TableCell className="text-right">
                        {/* Nobody asks their own site to send them what is
                            already standing there. */}
                        {site.locationId === plan.viewerLocationId ? (
                          <span className="text-xs text-muted-foreground">
                            Your site
                          </span>
                        ) : (
                          site.available > 0 && (
                            <Button variant="outline" size="sm" onClick={() => openAsk(site)}>
                              <Truck className="size-4" />
                              Ask for stock
                            </Button>
                          )
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {plan.moves.length > 0 && (
              <div className="mt-4 rounded-md border border-border bg-muted/40 p-3">
                <p className="text-sm font-medium">
                  {plan.availableHere > 0
                    ? `${formatQty(plan.availableHere)} of these are already here`
                    : "None of these are here"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {plan.moves.length > 1
                    ? "Taking the largest holdings first keeps it to the fewest consignments:"
                    : "What would have to be sent here:"}
                </p>
                <ul className="mt-2 space-y-1">
                  {plan.moves.map((m) => (
                    <li key={m.locationId} className="flex items-center gap-2 text-sm">
                      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate">
                        {formatQty(m.quantity)} from {m.locationName}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={askSite !== null} onOpenChange={(o) => !o && setAskSite(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ask {askSite?.locationName} for stock</DialogTitle>
            <DialogDescription>
              They decide whether they can spare it. If they agree, a dispatch is raised
              automatically and arrives the usual way.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {askForOptions.length > 0 && (
              <div className="space-y-2">
                <Label>Send it to</Label>
                <Select
                  value={askFor}
                  items={askForOptions.map((d) => ({ value: d.id, label: d.name }))}
                  onValueChange={(v) => setAskFor((v as string) ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Which site needs this?" />
                  </SelectTrigger>
                  <SelectContent>
                    {askForOptions.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  You can see every site, so there is no home site to assume.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="ask-qty">
                How many {plan?.product.unit ? `(${plan.product.unit})` : ""}
              </Label>
              <Input
                id="ask-qty"
                type="number"
                min={1}
                max={askSite ? Math.floor(askSite.available) : undefined}
                value={askQty}
                onChange={(e) => setAskQty(e.target.value)}
              />
              {askSite && (
                <p className="text-xs text-muted-foreground">
                  {formatQty(askSite.available)} free there right now.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ask-notes">Why (optional)</Label>
              <Textarea
                id="ask-notes"
                value={askNotes}
                onChange={(e) => setAskNotes(e.target.value)}
                placeholder="Anything that helps them decide — an order number, a date"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAskSite(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitAsk} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The answer in one sentence, before any table. */
function Verdict({ plan }: { plan: Plan }) {
  const unit = plan.product.unit;

  if (plan.coveredByStock) {
    return (
      <Banner tone="good" icon={<PackageCheck className="size-5" />}>
        <strong>Yes — this can ship from stock.</strong>{" "}
        {plan.singleSite
          ? `${plan.singleSite} alone is holding enough.`
          : `No single site has all ${formatQty(plan.wanted)}, but together they do.`}
      </Banner>
    );
  }

  if (plan.coveredWithBuilding) {
    return (
      <Banner tone="warn" icon={<Hammer className="size-5" />}>
        <strong>Yes, but {formatQty(plan.shortAfterStock)} would have to be built.</strong>{" "}
        {formatQty(plan.totalAvailable)} {unit} is on the shelf, and the components exist
        to make the rest.
      </Banner>
    );
  }

  return (
    <Banner tone="bad" icon={<CircleAlert className="size-5" />}>
      <strong>Not in full — short by {formatQty(plan.shortAfterBuilding)}.</strong>{" "}
      {formatQty(plan.totalAvailable)} {unit} in stock
      {plan.totalBuildable > 0 && `, ${formatQty(plan.totalBuildable)} more could be built`}
      . The remainder has to be bought or scheduled.
    </Banner>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: "good" | "warn" | "bad";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-md border p-3 text-sm",
        tone === "good" && "border-primary/30 bg-primary/5 text-foreground",
        tone === "warn" && "border-amber-500/30 bg-amber-500/5 text-foreground",
        tone === "bad" && "border-destructive/30 bg-destructive/5 text-foreground"
      )}
    >
      <span
        className={cn(
          "shrink-0",
          tone === "good" && "text-primary",
          tone === "warn" && "text-amber-600 dark:text-amber-500",
          tone === "bad" && "text-destructive"
        )}
      >
        {icon}
      </span>
      <p className="min-w-0">{children}</p>
    </div>
  );
}
