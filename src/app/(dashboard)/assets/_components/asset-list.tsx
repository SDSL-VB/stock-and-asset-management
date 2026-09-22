"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
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
import { Search, MapPin, Package } from "lucide-react";
import { WriteOffDialog } from "../../stock/_components/write-off-dialog";

/**
 * What each department is holding.
 *
 * "Asset" is not a separate register in this system: every row here is a
 * StockIssue, the record of stock having MOVED out of central stock into a
 * department. The `isAsset` flag on that movement is all the word means.
 *
 * Quantities shown are net of write-offs — a department that has written its
 * damaged stock off is not still holding it. That arithmetic is `heldByIssue()`
 * in `src/lib/stock-availability.ts`, never `issue.quantity` raw.
 *
 * Two permissions shape what is drawn: `canSeeValue` (stock.value.view) hides
 * the money columns, and `canWriteOff` (stock.writeoff.department) is what puts
 * the "Report loss" action on a row.
 */

type Asset = {
  id: string;
  issueNumber: string;
  quantity: number;
  receivedAt: Date;
  itemCode: string | null;
  itemName: string;
  categoryName: string | null;
  vendorName: string;
  entryId: string;
  entryNumber: string;
  departmentId: string;
  departmentName: string;
  locationName: string | null;
  issuedByName: string;
  unitPrice: number | null;
  value: number | null;
  /** How much of this holding is still free to report as unusable */
  availableToWriteOff: number;
  /** How much of it has already been written off, if any */
  writtenOff: number;
};

interface Props {
  assets: Asset[];
  canSeeValue?: boolean;
  /** Without this key the write-off column is not rendered at all */
  canWriteOff?: boolean;
}

export function AssetList({ assets, canSeeValue = false, canWriteOff = false }: Props) {
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");

  const departments = useMemo(() => {
    const map = new Map<string, string>();
    assets.forEach((a) => map.set(a.departmentId, a.departmentName));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [assets]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (departmentFilter !== "all" && a.departmentId !== departmentFilter) return false;
      if (!q) return true;
      return (
        a.itemName.toLowerCase().includes(q) ||
        (a.itemCode ?? "").toLowerCase().includes(q) ||
        a.departmentName.toLowerCase().includes(q) ||
        (a.locationName ?? "").toLowerCase().includes(q) ||
        a.vendorName.toLowerCase().includes(q)
      );
    });
  }, [assets, search, departmentFilter]);

  const totalUnits = filtered.reduce((sum, a) => sum + a.quantity, 0);
  const totalValue = canSeeValue
    ? filtered.reduce((sum, a) => sum + (a.value ?? 0), 0)
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by item, code, department, location, or vendor..."
            className="pl-9"
          />
        </div>
        <Select
          value={departmentFilter}
          items={[
            { value: "all", label: "All departments" },
            ...departments.map(([id, name]) => ({ value: id, label: name })),
          ]}
          onValueChange={(v) => setDepartmentFilter((v as string) ?? "all")}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="All departments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departments.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-3">
        <Card className="flex-1 min-w-[180px]">
          <CardContent className="p-4">
            <p className="text-2xl font-semibold tabular-nums">{filtered.length}</p>
            <p className="text-sm text-muted-foreground">Asset lines</p>
          </CardContent>
        </Card>
        <Card className="flex-1 min-w-[180px]">
          <CardContent className="p-4">
            <p className="text-2xl font-semibold tabular-nums">{totalUnits}</p>
            <p className="text-sm text-muted-foreground">Units held</p>
          </CardContent>
        </Card>
        {/* Monetary worth is its own permission — the card is absent, not blanked */}
        {canSeeValue && (
          <Card className="flex-1 min-w-[180px]">
            <CardContent className="p-4">
              <p className="text-2xl font-semibold tabular-nums">
                ₹{(totalValue ?? 0).toLocaleString("en-IN")}
              </p>
              <p className="text-sm text-muted-foreground">Asset value</p>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  {canSeeValue && <TableHead className="text-right">Value</TableHead>}
                  <TableHead>Received</TableHead>
                  <TableHead>Entry</TableHead>
                  {/* Not rendered at all without the key — never a dead button */}
                  {canWriteOff && <TableHead className="text-right">Report</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={(canSeeValue ? 7 : 6) + (canWriteOff ? 1 : 0)}
                      className="h-24 text-center text-muted-foreground"
                    >
                      {assets.length === 0
                        ? "No assets yet. Stock becomes an asset when it is transferred into a department as one."
                        : "No assets match your search."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div className="flex items-start gap-2">
                          <Package className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{a.itemName}</p>
                            <p className="font-mono text-xs text-muted-foreground">
                              {a.itemCode ?? "—"}
                              {a.categoryName ? ` · ${a.categoryName}` : ""}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{a.departmentName}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" />
                          {a.locationName ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.quantity}
                        {/* Says why the number dropped, so a holding that
                            shrank does not just look wrong. */}
                        {a.writtenOff > 0 && (
                          <span className="block text-micro font-normal text-status-rejected">
                            {a.writtenOff} written off
                          </span>
                        )}
                      </TableCell>
                      {canSeeValue && (
                        <TableCell className="text-right tabular-nums">
                          ₹{(a.value ?? 0).toLocaleString("en-IN")}
                        </TableCell>
                      )}
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(a.receivedAt).toLocaleDateString("en-IN")}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/stock/${a.entryId}`}
                          className="font-mono text-sm text-brand-blue hover:underline"
                        >
                          {a.entryNumber}
                        </Link>
                      </TableCell>
                      {canWriteOff && (
                        <TableCell className="text-right">
                          {a.availableToWriteOff > 0 && (
                            <WriteOffDialog
                              compact
                              target={{
                                kind: "issue",
                                stockIssueId: a.id,
                                departmentName: a.departmentName,
                              }}
                              itemName={a.itemName}
                              available={a.availableToWriteOff}
                            />
                          )}
                        </TableCell>
                      )}
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
