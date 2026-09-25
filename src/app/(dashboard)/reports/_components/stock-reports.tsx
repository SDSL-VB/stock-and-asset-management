"use client";

import { Fragment, useState } from "react";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent } from "@/components/ui/tabs";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Package,
  IndianRupee,
  Download,
  Building2,
  Loader2,
  BarChart3,
  TrendingUp,
  Boxes,
  Truck,
  ShoppingCart,
  ChevronRight,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Area,
  AreaChart,
} from "recharts";
import {
  getInventoryOverview,
  getStockHoldings,
  type StockHoldingRow,
} from "@/lib/actions/reports";
import { cn } from "@/lib/utils";
import { GROUP_LABEL } from "@/lib/vocabulary";
import { formatCurrency, formatUnitPrice } from "@/lib/format";
import { groupHoldings, hasMixedPrices, provenanceLabel } from "@/lib/stock-grouping";
import { toast } from "sonner";
import { toCsv } from "@/lib/csv";
import { FilterSelect } from "@/components/shared/filter-select";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";


interface InventoryOverview {
  totalEntries: number;
  totalValue: number;
  approvedEntries: number;
  approvedQuantity: number;
  approvedValue: number;
  byDepartment: Array<{
    departmentId: string | null;
    centralLocation: string | null;
    departmentName: string;
    entries: number;
    quantity: number;
    value: number;
  }>;
  topItems: Array<{
    itemName: string;
    entries: number;
    quantity: number;
    value: number;
  }>;
  topSuppliers: Array<{
    supplierName: string;
    entries: number;
    value: number;
  }>;
  monthlyTrend: Array<{
    month: string;
    entries: number;
    value: number;
    quantity: number;
  }>;
}

interface Props {
  userPermissions: string[];
  inventoryOverview: InventoryOverview;
}


/**
 * Crore / lakh / thousand, hand-rolled on purpose.
 *
 * Intl's own compact notation abbreviates to "T" and "L" inconsistently across
 * ICU versions, and a stat tile that says "12.4T" when it means twelve lakh is
 * worse than no abbreviation at all. These four lines are predictable.
 */
function formatCompactCurrency(amount: number) {
  if (amount >= 10000000) return `${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  return amount.toString();
}

export function StockReports({ userPermissions, inventoryOverview }: Props) {
  // Monetary visibility is its own permission (stock.value.view)
  const canSeeValue = userPermissions.includes("stock.value.view");
  // Inventory state
  const [inventoryData, setInventoryData] = useState<InventoryOverview>(inventoryOverview);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  // Which "where the stock is" card is selected (null = all departments)
  const [selection, setSelection] = useState<
    | { type: "dept"; id: string; name: string }
    | { type: "central"; location: string; name: string }
    | null
  >(null);
  const [holdings, setHoldings] = useState<StockHoldingRow[] | null>(null);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [holdingsSearch, setHoldingsSearch] = useState("");
  // Raw materials we buy in versus products we make. Filtered here rather than
  // re-queried, because the holdings are already loaded.
  const [holdingsGroup, setHoldingsGroup] = useState<"all" | "BOUGHT_IN" | "MADE">("all");
  // Received between. Either end on its own is a valid question; the "to" day
  // counts whole, so asking for the 23rd includes everything booked that day.
  const [receivedFrom, setReceivedFrom] = useState("");
  const [receivedTo, setReceivedTo] = useState("");
  // By category, alongside the bought/made split. Built from what is actually
  // held here, so the dropdown never offers a choice that returns nothing.
  const [holdingsCategory, setHoldingsCategory] = useState("ALL");
  /**
   * One row per product, or one row per receipt.
   *
   * Consolidated is the default because "how much 4C_WIRE do we have" is the
   * question the reports page is asked, and the answer is one number: 30.
   * Opening the row says what that 30 cost — 23 at ₹234 and 7 at ₹239 — and
   * opening further shows the receipts behind each price.
   */
  const [holdingsView, setHoldingsView] = useState<"grouped" | "entries">("grouped");
  /** Which consolidated rows have been unfolded to show their receipts */
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [showGraphs, setShowGraphs] = useState(false);

  function toggleExpanded(key: string) {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function clearSelection() {
    setSelection(null);
    setHoldings(null);
    setHoldingsSearch("");
    setReceivedFrom("");
    setReceivedTo("");
    setHoldingsCategory("ALL");
    setExpandedKeys(new Set());
    setInventoryData(inventoryOverview);
  }

  async function selectDepartment(id: string, name: string) {
    if (selection?.type === "dept" && selection.id === id) {
      return clearSelection();
    }
    setSelection({ type: "dept", id, name });
    setHoldingsSearch("");
    setReceivedFrom("");
    setReceivedTo("");
    setHoldingsCategory("ALL");
    setExpandedKeys(new Set());
    setInventoryLoading(true);
    setHoldingsLoading(true);
    try {
      const [data, rows] = await Promise.all([
        getInventoryOverview(id),
        getStockHoldings({ departmentId: id }),
      ]);
      setInventoryData(data);
      setHoldings(rows);
    } finally {
      setInventoryLoading(false);
      setHoldingsLoading(false);
    }
  }

  async function selectCentral(location: string, name: string) {
    if (selection?.type === "central" && selection.location === location) {
      return clearSelection();
    }
    setSelection({ type: "central", location, name });
    setHoldingsSearch("");
    setReceivedFrom("");
    setReceivedTo("");
    setHoldingsCategory("ALL");
    setExpandedKeys(new Set());
    setInventoryData(inventoryOverview);
    setHoldingsLoading(true);
    try {
      const rows = await getStockHoldings({
        centralLocation: location,
      });
      setHoldings(rows);
    } finally {
      setHoldingsLoading(false);
    }
  }

  const holdingCategories = [
    ...new Set((holdings ?? []).map((r) => r.categoryName).filter(Boolean)),
  ].sort() as string[];

  const filteredHoldings = (holdings ?? []).filter((row) => {
    if (holdingsGroup !== "all" && row.group !== holdingsGroup) return false;
    if (holdingsCategory !== "ALL" && row.categoryName !== holdingsCategory) return false;
    const received = new Date(row.receivedAt).getTime();
    if (receivedFrom && received < new Date(`${receivedFrom}T00:00:00`).getTime()) return false;
    if (receivedTo && received > new Date(`${receivedTo}T23:59:59.999`).getTime()) return false;
    const q = holdingsSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      row.itemName.toLowerCase().includes(q) ||
      (row.itemCode ?? "").toLowerCase().includes(q) ||
      (row.categoryName ?? "").toLowerCase().includes(q) ||
      row.supplierName.toLowerCase().includes(q) ||
      row.entryNumber.toLowerCase().includes(q)
    );
  });

  /**
   * The same receipts, one row per product.
   *
   * Grouped from the FILTERED rows, so a search for a vendor narrows what each
   * consolidated row is made of rather than showing a total that includes
   * receipts the search excluded.
   */
  const groupedHoldings = groupHoldings(filteredHoldings);

  // Both totals side by side, so "what are we holding in raw materials" is
  // answerable without changing the filter
  const holdingTotals = (holdings ?? []).reduce(
    (acc, r) => {
      acc[r.group].count += 1;
      acc[r.group].value += r.value;
      return acc;
    },
    {
      BOUGHT_IN: { count: 0, value: 0 },
      MADE: { count: 0, value: 0 },
    }
  );

  /** One row per receipt — the sheet this page has always exported. */
  function entryHoldingsCsv() {
    return {
      headers: [
        "Entry Number", "Item Code", "Item Name", "Kind", "Category", "Supplier",
        "Batch",
        "Quantity Here",
        ...(canSeeValue ? ["Unit Price", "Value"] : []),
        "Received At Location", "Client", "Received Date",
      ],
      rows: filteredHoldings.map((r) => [
        r.entryNumber,
        r.itemCode ?? "",
        r.itemName,
        r.kindLabel,
        r.categoryName ?? "",
        r.supplierName,
        r.batchNumber ?? "",
        r.quantity.toString(),
        ...(canSeeValue ? [r.unitPrice.toFixed(2), r.value.toFixed(2)] : []),
        r.location,
        r.clientName ?? "",
        new Date(r.receivedAt).toLocaleDateString("en-IN"),
      ]),
    };
  }

  /**
   * One row per product, exactly as the table shows it: the whole quantity on
   * one line, with the prices behind it spelled out as "234.00 x 23; 239.00 x
   * 7". A spreadsheet has no chevron, and collapsing to a lone averaged price
   * would throw away the very thing that column exists for.
   */
  function groupedHoldingsCsv() {
    return {
      headers: [
        "Item Code", "Item Name", "Kind", "Category",
        "Quantity Here",
        ...(canSeeValue ? ["Prices", "Value"] : []),
        "Receipts", "Batches", "Suppliers", "First Received", "Last Received",
      ],
      rows: groupedHoldings.map((g) => [
        g.itemCode ?? "",
        g.itemName,
        g.kindLabel,
        g.categoryName ?? "",
        g.quantity.toString(),
        ...(canSeeValue
          ? [
              g.prices.map((level) => `${level.unitPrice.toFixed(2)} x ${level.quantity}`).join("; "),
              g.value.toFixed(2),
            ]
          : []),
        g.entryCount.toString(),
        g.batches.join("; "),
        g.suppliers.join("; "),
        new Date(g.oldestReceivedAt).toLocaleDateString("en-IN"),
        new Date(g.latestReceivedAt).toLocaleDateString("en-IN"),
      ]),
    };
  }

  /**
   * The CSV follows whichever view is on screen, so what downloads is what was
   * being looked at.
   */
  function exportHoldings() {
    if (!selection) return;

    const { headers, rows } =
      holdingsView === "grouped" ? groupedHoldingsCsv() : entryHoldingsCsv();
    if (rows.length === 0) return;

    const csv = toCsv(headers, rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const place = selection.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const shape = holdingsView === "grouped" ? "by-product" : "by-entry";
    a.href = url;
    a.download = `stock-holdings-${shape}-${place}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Holdings exported");
  }

  const holdingsTotalQty = filteredHoldings.reduce((s, r) => s + r.quantity, 0);
  const holdingsTotalValue = filteredHoldings.reduce((s, r) => s + r.value, 0);


  return (
    <Tabs defaultValue="inventory" className="space-y-6">
      {/* ===================== */}
      {/* INVENTORY OVERVIEW TAB */}
      {/* ===================== */}
      <TabsContent value="inventory" className="space-y-6">
        {/* Top-level stats — reflect the selected department's actual holdings */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title={selection?.type === "dept" ? `Stock in ${selection.name}` : "Total Stock In"}
            value={inventoryData.approvedEntries}
            description={`${inventoryData.approvedQuantity.toLocaleString("en-IN")} units`}
            icon={Package}
            tone="approved"
          />
          {canSeeValue && (
            <StatCard
              title="Stock Value"
              value={formatCurrency(inventoryData.approvedValue)}
              description={selection?.type === "dept" ? "Held by this department" : "Total approved stock value"}
              icon={IndianRupee}
              tone="info"
            />
          )}
          <StatCard
            title="Total Entries"
            value={inventoryData.totalEntries}
            description="All statuses combined"
            icon={Boxes}
            tone="info"
          />
          {canSeeValue && (
            <StatCard
              title="Pipeline Value"
              value={formatCurrency(Math.max(0, inventoryData.totalValue - inventoryData.approvedValue))}
              description="Draft + pending entries"
              icon={TrendingUp}
              tone="pending"
            />
          )}
        </div>

        {/* Where the stock is — persistent, clickable filter cards */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-5 w-5 text-brand-blue" />
                Where the Stock Is
                {inventoryLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </CardTitle>
              <div className="flex items-center gap-2">
                {selection && (
                  <Button variant="ghost" size="sm" onClick={clearSelection}>
                    Show all
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowGraphs((v) => !v)}
                >
                  <BarChart3 className="mr-2 h-4 w-4" />
                  {showGraphs ? "Hide Graphs" : "Show Graphs"}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Click a card to see exactly what that department or central stock holds.
              Click again to go back to everything.
            </p>
          </CardHeader>
          <CardContent>
            {inventoryOverview.byDepartment.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No approved stock yet.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {inventoryOverview.byDepartment.map((dept) => {
                  const isSelected =
                    (dept.departmentId &&
                      selection?.type === "dept" &&
                      selection.id === dept.departmentId) ||
                    (dept.centralLocation &&
                      selection?.type === "central" &&
                      selection.location === dept.centralLocation);
                  const isCentral = dept.centralLocation !== null;
                  return (
                    <button
                      key={dept.departmentName}
                      className={`rounded-lg border p-4 text-left transition-colors ${
                        isSelected
                          ? "border-brand-green bg-brand-green/10 ring-1 ring-brand-green/40"
                          : "hover:border-brand-green/50 hover:bg-brand-green/5"
                      }`}
                      onClick={() =>
                        isCentral
                          ? selectCentral(dept.centralLocation!, dept.departmentName)
                          : dept.departmentId &&
                            selectDepartment(dept.departmentId, dept.departmentName)
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-semibold">{dept.departmentName}</p>
                        {isCentral && (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            <Boxes className="mr-1 h-3 w-3" />
                            Central
                          </Badge>
                        )}
                      </div>
                      <div className={`mt-2 grid grid-cols-2 gap-2 ${canSeeValue ? "sm:grid-cols-3" : ""}`}>
                        <div>
                          <p className="text-xs text-muted-foreground">Items</p>
                          <p className="text-lg font-bold">{dept.entries}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Units</p>
                          <p className="text-lg font-bold">{dept.quantity.toLocaleString("en-IN")}</p>
                        </div>
                        {canSeeValue && (
                          <div>
                            <p className="text-xs text-muted-foreground">Value</p>
                            <p className="text-lg font-bold text-brand-green">{formatCompactCurrency(dept.value)}</p>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Holdings table for the selected place — searchable & exportable */}
        {selection && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-5 w-5 text-brand-green" />
                  What&apos;s in {selection.name}
                </CardTitle>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>
                    {holdingsTotalQty.toLocaleString("en-IN")} units
                    {canSeeValue && ` · ${formatCurrency(holdingsTotalValue)}`}
                  </span>
                  {userPermissions.includes("reports.export") && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={filteredHoldings.length === 0}
                      onClick={exportHoldings}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Export CSV
                    </Button>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <div className="min-w-[220px] flex-1 space-y-1 sm:max-w-sm">
                  <Label className="text-xs text-muted-foreground">Search</Label>
                  <Input
                    value={holdingsSearch}
                    onChange={(e) => setHoldingsSearch(e.target.value)}
                    placeholder="Item, code, category, supplier..."
                    className="h-9"
                  />
                </div>

                {holdingCategories.length > 0 && (
                  <FilterSelect
                    label="Category"
                    value={holdingsCategory}
                    onChange={setHoldingsCategory}
                    options={[
                      { value: "ALL", label: "Any category" },
                      ...holdingCategories.map((name) => ({ value: name, label: name })),
                    ]}
                  />
                )}

                {/* Received between. The export follows this, like every other
                    filter here — what downloads is what is on screen. */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Received between</Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="date"
                      value={receivedFrom}
                      max={receivedTo || undefined}
                      onChange={(e) => setReceivedFrom(e.target.value)}
                      className="h-9 w-[9.5rem]"
                      aria-label="Received from"
                    />
                    <span className="text-caption text-muted-foreground">to</span>
                    <Input
                      type="date"
                      value={receivedTo}
                      min={receivedFrom || undefined}
                      onChange={(e) => setReceivedTo(e.target.value)}
                      className="h-9 w-[9.5rem]"
                      aria-label="Received until"
                    />
                    {(receivedFrom || receivedTo) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setReceivedFrom("");
                          setReceivedTo("");
                        }}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </div>

                {/*
                  Two dropdowns rather than two rows of chips: what to include,
                  and how to count it. The counts ride in the labels so nothing
                  is lost, and a row of filters reads the same way everywhere —
                  a label, a control, a value.
                */}
                <FilterSelect
                  label="Show"
                  value={holdingsGroup}
                  onChange={(v) => setHoldingsGroup(v as typeof holdingsGroup)}
                  options={[
                    { value: "all", label: `Everything (${(holdings ?? []).length})` },
                    { value: "BOUGHT_IN", label: `${GROUP_LABEL.BOUGHT_IN} (${holdingTotals.BOUGHT_IN.count})` },
                    { value: "MADE", label: `${GROUP_LABEL.MADE} (${holdingTotals.MADE.count})` },
                  ]}
                />

                <FilterSelect
                  label="Rows"
                  value={holdingsView}
                  onChange={(v) => setHoldingsView(v as typeof holdingsView)}
                  options={[
                    { value: "grouped", label: `One per product (${groupedHoldings.length})` },
                    { value: "entries", label: `One per receipt (${filteredHoldings.length})` },
                  ]}
                />

                {canSeeValue && (
                  <span className="text-caption text-muted-foreground tabular-nums">
                    {GROUP_LABEL.BOUGHT_IN} {formatCurrency(holdingTotals.BOUGHT_IN.value)} ·{" "}
                    {GROUP_LABEL.MADE} {formatCurrency(holdingTotals.MADE.value)}
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {holdingsLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : holdingsView === "grouped" ? (
                /*
                  One row per product. Where it was bought at several prices
                  the column shows the range, never an average — the real
                  prices are one level down, inside the row.
                */
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Qty Here</TableHead>
                      {canSeeValue && <TableHead className="text-right">Unit Price</TableHead>}
                      {canSeeValue && <TableHead className="text-right">Value</TableHead>}
                      <TableHead>Received</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupedHoldings.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={canSeeValue ? 8 : 6}
                          className="h-24 text-center text-muted-foreground"
                        >
                          {holdings && holdings.length > 0
                            ? "No items match your search."
                            : "Nothing is currently held here."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      groupedHoldings.map((group) => {
                        // A single receipt at a single price has nothing to
                        // unfold — the row already shows everything there is.
                        const expandable = group.entryCount > 1 || group.prices.length > 1;
                        const expanded = expandable && expandedKeys.has(group.key);

                        return (
                          <Fragment key={group.key}>
                            <TableRow
                              className={cn(expandable && "cursor-pointer")}
                              onClick={expandable ? () => toggleExpanded(group.key) : undefined}
                            >
                              <TableCell className="font-medium">
                                <span className="flex items-start gap-1.5">
                                  {expandable ? (
                                    <ChevronRight
                                      className={cn(
                                        "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                                        expanded && "rotate-90"
                                      )}
                                    />
                                  ) : (
                                    <span className="w-3.5 shrink-0" />
                                  )}
                                  <span>
                                    {group.itemName}
                                    <span className="block text-micro font-normal text-muted-foreground">
                                      {provenanceLabel(group)}
                                    </span>
                                  </span>
                                </span>
                              </TableCell>
                              <TableCell className="font-mono text-xs font-semibold">
                                {group.itemCode ?? "—"}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-micro",
                                    group.group === "MADE"
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                      : "border-slate-200 bg-slate-100 text-slate-700"
                                  )}
                                >
                                  {group.kindLabel}
                                </Badge>
                              </TableCell>
                              <TableCell>{group.categoryName ?? "—"}</TableCell>
                              <TableCell className="text-right font-semibold tabular-nums">
                                {group.quantity.toLocaleString("en-IN")}
                              </TableCell>
                              {canSeeValue && (
                                <TableCell className="text-right">
                                  <span className="tabular-nums">
                                    {hasMixedPrices(group)
                                      ? `${formatUnitPrice(group.minUnitPrice)} – ${formatUnitPrice(group.maxUnitPrice)}`
                                      : formatUnitPrice(group.minUnitPrice)}
                                  </span>
                                </TableCell>
                              )}
                              {canSeeValue && (
                                <TableCell className="text-right font-semibold tabular-nums text-brand-green">
                                  {formatCurrency(group.value)}
                                </TableCell>
                              )}
                              <TableCell className="text-xs text-muted-foreground">
                                {new Date(group.latestReceivedAt).toLocaleDateString("en-IN", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                })}
                                {group.entryCount > 1 && (
                                  <span className="block">
                                    from{" "}
                                    {new Date(group.oldestReceivedAt).toLocaleDateString("en-IN", {
                                      day: "2-digit",
                                      month: "short",
                                      year: "numeric",
                                    })}
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>

                            {/* What the row is made of: one line per price —
                                everything bought at ₹234 added together — and
                                under it the receipts that made up that price. */}
                            {expanded &&
                              group.prices.map((level) => (
                                <Fragment key={`${group.key}@${level.unitPrice}`}>
                                  <TableRow className="bg-muted/40">
                                    <TableCell colSpan={4} className="pl-9 text-xs font-medium">
                                      {canSeeValue
                                        ? `Bought at ${formatUnitPrice(level.unitPrice)}`
                                        : "Bought together"}
                                      <span className="ml-1.5 font-normal text-muted-foreground">
                                        {level.entryCount} receipt{level.entryCount === 1 ? "" : "s"}
                                        {level.batches.length > 0 ? ` · ${level.batches.length} batch${level.batches.length === 1 ? "" : "es"}` : ""}
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-right text-xs font-semibold tabular-nums">
                                      {level.quantity.toLocaleString("en-IN")}
                                    </TableCell>
                                    {canSeeValue && (
                                      <TableCell className="text-right text-xs tabular-nums">
                                        {formatUnitPrice(level.unitPrice)}
                                      </TableCell>
                                    )}
                                    {canSeeValue && (
                                      <TableCell className="text-right text-xs font-semibold tabular-nums">
                                        {formatCurrency(level.value)}
                                      </TableCell>
                                    )}
                                    <TableCell />
                                  </TableRow>

                                  {level.entries.map((row) => (
                                    <TableRow key={row.entryId} className="bg-muted/20">
                                      <TableCell className="pl-14 text-xs text-muted-foreground">
                                        <span className="font-mono">{row.entryNumber}</span>
                                        <span className="block">
                                          {row.supplierName}
                                          {row.batchNumber ? ` · batch ${row.batchNumber}` : ""}
                                        </span>
                                      </TableCell>
                                      <TableCell colSpan={3} className="text-xs text-muted-foreground">
                                        {row.location}
                                        {row.clientName ? ` · ${row.clientName}` : ""}
                                      </TableCell>
                                      <TableCell className="text-right text-xs tabular-nums">
                                        {row.quantity.toLocaleString("en-IN")}
                                      </TableCell>
                                      {canSeeValue && (
                                        <TableCell className="text-right text-xs tabular-nums">
                                          {formatUnitPrice(row.unitPrice)}
                                        </TableCell>
                                      )}
                                      {canSeeValue && (
                                        <TableCell className="text-right text-xs tabular-nums">
                                          {formatCurrency(row.value)}
                                        </TableCell>
                                      )}
                                      <TableCell className="text-xs text-muted-foreground">
                                        {new Date(row.receivedAt).toLocaleDateString("en-IN", {
                                          day: "2-digit",
                                          month: "short",
                                          year: "numeric",
                                        })}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </Fragment>
                              ))}
                          </Fragment>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entry #</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Qty Here</TableHead>
                      {canSeeValue && <TableHead className="text-right">Unit Price</TableHead>}
                      {canSeeValue && <TableHead className="text-right">Value</TableHead>}
                      <TableHead>Received</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredHoldings.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={canSeeValue ? 10 : 8}
                          className="h-24 text-center text-muted-foreground"
                        >
                          {holdings && holdings.length > 0
                            ? "No items match your search."
                            : "Nothing is currently held here."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredHoldings.map((row) => (
                        <TableRow key={`${row.entryId}`}>
                          <TableCell className="font-mono text-xs">{row.entryNumber}</TableCell>
                          <TableCell className="font-mono text-xs font-semibold">
                            {row.itemCode ?? "—"}
                          </TableCell>
                          <TableCell className="font-medium">{row.itemName}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-micro",
                                row.group === "MADE"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                  : "border-slate-200 bg-slate-100 text-slate-700"
                              )}
                            >
                              {row.kindLabel}
                            </Badge>
                          </TableCell>
                          <TableCell>{row.categoryName ?? "—"}</TableCell>
                          <TableCell>{row.supplierName}</TableCell>
                          <TableCell className="text-right font-semibold">
                            {row.quantity.toLocaleString("en-IN")}
                          </TableCell>
                          {canSeeValue && (
                            <TableCell className="text-right">{formatCurrency(row.unitPrice)}</TableCell>
                          )}
                          {canSeeValue && (
                            <TableCell className="text-right font-semibold text-brand-green">
                              {formatCurrency(row.value)}
                            </TableCell>
                          )}
                          <TableCell className="text-xs">
                            {row.location}
                            {row.clientName ? ` · ${row.clientName}` : ""}
                            <span className="block text-muted-foreground">
                              {new Date(row.receivedAt).toLocaleDateString("en-IN", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              })}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {/* Charts — only when asked for */}
        {showGraphs && (
        <>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Monthly Trend */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-brand-green" />
                Monthly Stock In Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              {inventoryData.monthlyTrend.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No data yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={inventoryData.monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                    <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                    <Tooltip formatter={(value) => value} />
                    {canSeeValue && (
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke="#00A86B"
                        fill="#00A86B"
                        fillOpacity={0.1}
                        name="Value"
                      />
                    )}
                    <Area
                      type="monotone"
                      dataKey="quantity"
                      stroke="#0ea5e9"
                      fill="#0ea5e9"
                      fillOpacity={0.1}
                      name="Quantity"
                      yAxisId={0}
                    />
                    <Legend />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Department Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-5 w-5 text-brand-blue" />
                Stock by Department
              </CardTitle>
            </CardHeader>
            <CardContent>
              {inventoryData.byDepartment.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No department data</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={inventoryData.byDepartment} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                    <YAxis
                      type="category"
                      dataKey="departmentName"
                      tick={{ fontSize: 11 }}
                      className="fill-muted-foreground"
                      width={100}
                    />
                    <Tooltip formatter={(value) => value} />
                    <Bar
                      dataKey={canSeeValue ? "value" : "quantity"}
                      fill="#00A86B"
                      name={canSeeValue ? "Value" : "Units"}
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Top Items & Suppliers */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Top Items */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-purple-600" />
                Top Items by Value
              </CardTitle>
            </CardHeader>
            <CardContent>
              {inventoryData.topItems.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No approved items yet</p>
              ) : (
                <div className="space-y-2">
                  {inventoryData.topItems.map((item, i) => (
                    <div key={item.itemName} className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold shrink-0">
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{item.itemName}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.quantity.toLocaleString("en-IN")} units &middot; {item.entries} entries
                          </p>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-brand-green shrink-0 ml-2">
                        {canSeeValue
                          ? formatCurrency(item.value)
                          : `${item.quantity.toLocaleString("en-IN")} units`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Suppliers */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="h-5 w-5 text-amber-600" />
                Top Suppliers by Value
              </CardTitle>
            </CardHeader>
            <CardContent>
              {inventoryData.topSuppliers.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No supplier data yet</p>
              ) : (
                <div className="space-y-2">
                  {inventoryData.topSuppliers.map((supplier, i) => {
                    const pct = inventoryData.approvedValue > 0
                      ? (supplier.value / inventoryData.approvedValue) * 100
                      : 0;
                    return (
                      <div key={supplier.supplierName} className="rounded-lg border p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold shrink-0">
                              {i + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{supplier.supplierName}</p>
                              <p className="text-xs text-muted-foreground">{supplier.entries} entries</p>
                            </div>
                          </div>
                          {canSeeValue && (
                            <span className="text-sm font-semibold shrink-0 ml-2">
                              {formatCurrency(supplier.value)}
                            </span>
                          )}
                        </div>
                        {canSeeValue && (
                          <>
                            <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full bg-amber-500"
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 text-right">{pct.toFixed(1)}% of total</p>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        </>
        )}
      </TabsContent>
    </Tabs>
  );
}
