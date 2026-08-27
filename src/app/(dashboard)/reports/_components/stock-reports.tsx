"use client";

import { useState } from "react";
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
  getStockReport,
  exportStockReport,
  getInventoryOverview,
  getStockHoldings,
  type StockHoldingRow,
} from "@/lib/actions/reports";
import { cn } from "@/lib/utils";
import { GROUP_LABEL } from "@/lib/vocabulary";
import { toast } from "sonner";

interface SummaryStats {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  totalApprovedValue: number;
  byDepartment: Array<{
    departmentName: string;
    count: number;
    totalValue: number;
  }>;
  last30Days: Array<{
    status: string;
    count: number;
  }>;
}

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
  summaryStats: SummaryStats;
  departments: { id: string; name: string }[];
  userPermissions: string[];
  inventoryOverview: InventoryOverview;
}

type ReportEntry = {
  id: string;
  entryNumber: string;
  itemName: string;
  supplierName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  status: string;
  invoiceNumber: string | null;
  createdAt: Date;
  location: { id: string; name: string } | null;
  department: { name: string } | null;
  createdBy: { name: string };
  approvedBy: { name: string } | null;
  issues: Array<{ quantity: number; department: { name: string } }>;
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatCompactCurrency(amount: number) {
  if (amount >= 10000000) return `${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  return amount.toString();
}

export function StockReports({ summaryStats, departments, userPermissions, inventoryOverview }: Props) {
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
  const [showGraphs, setShowGraphs] = useState(false);

  async function clearSelection() {
    setSelection(null);
    setHoldings(null);
    setHoldingsSearch("");
    setInventoryData(inventoryOverview);
  }

  async function selectDepartment(id: string, name: string) {
    if (selection?.type === "dept" && selection.id === id) {
      return clearSelection();
    }
    setSelection({ type: "dept", id, name });
    setHoldingsSearch("");
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

  const filteredHoldings = (holdings ?? []).filter((row) => {
    if (holdingsGroup !== "all" && row.group !== holdingsGroup) return false;
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

  function exportHoldings() {
    if (!selection || filteredHoldings.length === 0) return;
    const headers = [
      "Entry Number", "Item Code", "Item Name", "Kind", "Category", "Supplier",
      "Quantity Here",
      ...(canSeeValue ? ["Unit Price", "Value"] : []),
      "Received At Location", "Client", "Received Date",
    ];
    const rows = filteredHoldings.map((r) => [
      r.entryNumber,
      r.itemCode ?? "",
      r.itemName,
      r.kindLabel,
      r.categoryName ?? "",
      r.supplierName,
      r.quantity.toString(),
      ...(canSeeValue ? [r.unitPrice.toFixed(2), r.value.toFixed(2)] : []),
      r.location,
      r.clientName ?? "",
      new Date(r.receivedAt).toLocaleDateString("en-IN"),
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock-holdings-${selection.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Holdings exported");
  }

  const holdingsTotalQty = filteredHoldings.reduce((s, r) => s + r.quantity, 0);
  const holdingsTotalValue = filteredHoldings.reduce((s, r) => s + r.value, 0);

  // Chart data
  const statusData = [
    { name: "Approved", value: summaryStats.approved, color: "#059669" },
    { name: "Pending", value: summaryStats.pending, color: "#f59e0b" },
    { name: "Rejected", value: summaryStats.rejected, color: "#ef4444" },
    { name: "Draft", value: summaryStats.total - summaryStats.approved - summaryStats.pending - summaryStats.rejected, color: "#6b7280" },
  ].filter((d) => d.value > 0);

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
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
                  <Input
                    value={holdingsSearch}
                    onChange={(e) => setHoldingsSearch(e.target.value)}
                    placeholder="Search by item, code, category, supplier..."
                  />
                </div>

                {/*
                  Raw materials and products, side by side. The counts come from
                  everything held, not the filtered view, so switching between
                  them never changes what the other one says.
                */}
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ["all", "Everything", (holdings ?? []).length],
                      ["BOUGHT_IN", GROUP_LABEL.BOUGHT_IN, holdingTotals.BOUGHT_IN.count],
                      ["MADE", GROUP_LABEL.MADE, holdingTotals.MADE.count],
                    ] as const
                  ).map(([value, label, count]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setHoldingsGroup(value)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-caption transition-colors",
                        holdingsGroup === value
                          ? "border-primary/40 bg-primary/10 font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/60"
                      )}
                    >
                      {label}
                      <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
                    </button>
                  ))}
                </div>

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
