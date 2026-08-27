"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { KIND_LABEL, type ProductKind } from "@/lib/vocabulary";

/**
 * The filter bar above the stock list: what it is, how it got here, and where.
 *
 * Used by: `stock-entry-list.tsx`, which owns the state and does the filtering.
 *
 * Two rules worth knowing, because they are why this file has more code than a
 * row of dropdowns needs:
 *
 *   1. Every option offered has to exist in the entries in front of you. A
 *      choice that can only ever return nothing is a dead control, and this
 *      system does not render those. KIT products are never stocked, for
 *      instance, so that option simply never appears.
 *   2. A filter with only one possible answer is not a filter. Someone who can
 *      see one site is not offered a site dropdown containing their own site.
 */

/** How a batch of goods came to be here. Narrower than the `source` column. */
export type SourceFilter = "ALL" | "FRESH" | "ORDER" | "BUILT" | "TRANSFERRED";

export const SOURCE_LABEL: Record<Exclude<SourceFilter, "ALL">, string> = {
  FRESH: "Fresh stock",
  ORDER: "Against an order",
  BUILT: "Built here",
  TRANSFERRED: "Transferred in",
};

export type Filters = {
  source: SourceFilter;
  kind: ProductKind | "ALL";
  category: string;
  site: string;
  holding: "ALL" | "STOCK" | "ASSET";
};

export const NO_FILTERS: Filters = {
  source: "ALL",
  kind: "ALL",
  category: "ALL",
  site: "ALL",
  holding: "ALL",
};

/** What an entry counts as, for the source filter. */
export function sourceOf(entry: {
  source: string;
  purchaseOrderLineId: string | null;
}): Exclude<SourceFilter, "ALL"> {
  if (entry.source === "BUILT") return "BUILT";
  if (entry.source === "TRANSFERRED") return "TRANSFERRED";
  // Bought in, either way — an order line is what separates the two
  return entry.purchaseOrderLineId ? "ORDER" : "FRESH";
}

type Option = { value: string; label: string };

interface Props {
  filters: Filters;
  onChange: (next: Filters) => void;
  /** Built from every entry the person can see, not from the filtered list */
  options: {
    sources: Option[];
    kinds: Option[];
    categories: Option[];
    sites: Option[];
    holdings: Option[];
  };
  showing: number;
  total: number;
}

/** One dropdown, or nothing at all when there is nothing to choose between. */
function FilterSelect({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: string;
  options: Option[];
  onValueChange: (value: string) => void;
}) {
  // One real option is not a choice — see rule 2 at the top of the file
  if (options.length < 2) return null;

  const items = [{ value: "ALL", label }, ...options];

  return (
    <Select
      value={value}
      items={items}
      onValueChange={(v) => onValueChange((v as string) ?? "ALL")}
    >
      <SelectTrigger className="h-9 w-auto min-w-40">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function EntryFilters({ filters, onChange, options, showing, total }: Props) {
  const active =
    filters.source !== "ALL" ||
    filters.kind !== "ALL" ||
    filters.category !== "ALL" ||
    filters.site !== "ALL" ||
    filters.holding !== "ALL";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterSelect
        label="Any kind"
        value={filters.kind}
        options={options.kinds}
        onValueChange={(v) => onChange({ ...filters, kind: v as Filters["kind"] })}
      />
      <FilterSelect
        label="However it arrived"
        value={filters.source}
        options={options.sources}
        onValueChange={(v) => onChange({ ...filters, source: v as SourceFilter })}
      />
      <FilterSelect
        label="Any category"
        value={filters.category}
        options={options.categories}
        onValueChange={(v) => onChange({ ...filters, category: v })}
      />
      <FilterSelect
        label="Any site"
        value={filters.site}
        options={options.sites}
        onValueChange={(v) => onChange({ ...filters, site: v })}
      />
      <FilterSelect
        label="Stock and assets"
        value={filters.holding}
        options={options.holdings}
        onValueChange={(v) => onChange({ ...filters, holding: v as Filters["holding"] })}
      />

      {active && (
        <>
          <span className="text-sm text-muted-foreground">
            Showing {showing} of {total}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ ...NO_FILTERS })}
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Clear
          </Button>
        </>
      )}
    </div>
  );
}

/** The label for a kind, so the bar and the catalog always agree. */
export function kindLabel(kind: ProductKind): string {
  return KIND_LABEL[kind];
}
