"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Search, Check, PackageCheck, Sparkles } from "lucide-react";

export type OpenOrderLine = {
  lineId: string;
  orderId: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  locationId: string;
  locationName: string;
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  categoryId: string;
  categoryName: string;
  ordered: number;
  delivered: number;
  outstanding: number;
};

interface Props {
  lines: OpenOrderLine[];
  selected: OpenOrderLine | null;
  onSelect: (line: OpenOrderLine | null) => void;
  disabled?: boolean;
}

/**
 * "Is this fresh stock, or against an order?"
 *
 * The first question on the form, because the answer fills in most of the rest.
 * Picking a line sets the product, the vendor, the site and the quantity still
 * owed — the operator confirms what actually turned up rather than retyping it.
 */
export function PurchaseOrderPicker({ lines, selected, onSelect, disabled }: Props) {
  const [mode, setMode] = useState<"fresh" | "order">(selected ? "order" : "fresh");
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lines.slice(0, 8);
    return lines
      .filter(
        (l) =>
          l.poNumber.toLowerCase().includes(q) ||
          l.productName.toLowerCase().includes(q) ||
          l.productCode.toLowerCase().includes(q) ||
          l.vendorName.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [lines, query]);

  function choose(next: "fresh" | "order") {
    setMode(next);
    if (next === "fresh") onSelect(null);
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div>
        <Label className="text-sm font-medium">Where have these goods come from?</Label>
        <p className="mt-0.5 text-caption text-muted-foreground">
          {lines.length === 0
            ? "No purchase order is waiting on a delivery, so this is fresh stock."
            : "Booking against an order fills in the product, vendor and what is still owed."}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => choose("fresh")}
          className={cn(
            "flex items-start gap-3 rounded-md border p-3 text-left transition-colors",
            mode === "fresh"
              ? "border-primary bg-primary/5"
              : "border-border hover:bg-muted",
            disabled && "opacity-60"
          )}
        >
          <Sparkles
            className={cn(
              "mt-0.5 size-4 shrink-0",
              mode === "fresh" ? "text-primary" : "text-muted-foreground"
            )}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium">Fresh stock</span>
            <span className="block text-caption text-muted-foreground">
              Bought without an order behind it
            </span>
          </span>
        </button>

        <button
          type="button"
          disabled={disabled || lines.length === 0}
          onClick={() => choose("order")}
          className={cn(
            "flex items-start gap-3 rounded-md border p-3 text-left transition-colors",
            mode === "order"
              ? "border-primary bg-primary/5"
              : "border-border hover:bg-muted",
            (disabled || lines.length === 0) && "cursor-not-allowed opacity-60"
          )}
        >
          <PackageCheck
            className={cn(
              "mt-0.5 size-4 shrink-0",
              mode === "order" ? "text-primary" : "text-muted-foreground"
            )}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium">Against a purchase order</span>
            <span className="block text-caption text-muted-foreground">
              {lines.length === 0
                ? "Nothing is on order"
                : `${lines.length} line${lines.length === 1 ? "" : "s"} still expecting goods`}
            </span>
          </span>
        </button>
      </div>

      {mode === "order" && (
        <div className="space-y-2">
          {selected ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
              <Check className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-mono">{selected.poNumber}</span>{" "}
                <span className="font-medium">{selected.productName}</span>{" "}
                <span className="text-muted-foreground">
                  · {selected.vendorName} → {selected.locationName}
                </span>
              </span>
              <Badge variant="outline" className="shrink-0">
                {selected.outstanding} {selected.unit} still owed
              </Badge>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onSelect(null)}
              >
                Change
              </Button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by order number, item or vendor"
                  className="pl-9"
                  disabled={disabled}
                />
              </div>
              <div className="max-h-52 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {matches.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    Nothing matches “{query}”.
                  </p>
                ) : (
                  matches.map((l) => (
                    <button
                      key={l.lineId}
                      type="button"
                      disabled={disabled}
                      onClick={() => onSelect(l)}
                      className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">
                        <span className="font-mono text-xs">{l.poNumber}</span>{" "}
                        <span className="font-medium">{l.productName}</span>{" "}
                        <span className="text-muted-foreground">· {l.vendorName}</span>
                      </span>
                      <Badge variant="outline" className="shrink-0 tabular-nums">
                        {l.outstanding} of {l.ordered}
                      </Badge>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
          {selected && (
            <p className="text-micro text-muted-foreground">
              Enter what actually arrived. Less than {selected.outstanding} is fine — the order
              stays open showing the rest, and closes itself when the last of it comes in.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
