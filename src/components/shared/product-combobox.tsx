"use client";

import { useMemo } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pick one product by typing any part of it.
 *
 * Called by: the bill of materials editor, for each component line.
 *
 * A plain dropdown listing every product works for twenty items and fails for
 * a real parts list — the BLDC sheet alone runs to hundreds of lines — because
 * the only way to find something is to scroll. This searches as you type, over
 * the same fields the server-side product search reads, so a part is found by
 * whatever somebody happens to remember:
 *
 *   code         1004-PCB-3W_CONTROL_BOARD, or just "3w"
 *   name         3W_Control_Board
 *   description  "control board"
 *   subcategory  "pcb"
 *   category     "electronics"
 *
 * Every word typed has to match somewhere, in any order, so "board control"
 * and "pcb 3w" both find it. Results are capped so a one-letter query does not
 * render the whole catalog.
 *
 * The value is a product id (or "" for none), which is what the forms store, so
 * this drops in wherever a product <Select> used to be.
 */

export type ProductOption = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  category?: { name: string } | null;
  subcategory?: { name: string } | null;
};

/** Everything a query can match, lower-cased once rather than on each keystroke. */
function haystackOf(p: ProductOption): string {
  return [p.code, p.name, p.description, p.subcategory?.name, p.category?.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function ProductCombobox({
  products,
  value,
  onChange,
  placeholder = "Search by code, name or description…",
  disabled = false,
  className,
}: {
  products: ProductOption[];
  value: string;
  onChange: (productId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const haystacks = useMemo(
    () => new Map(products.map((p) => [p.id, haystackOf(p)])),
    [products]
  );
  const selected = products.find((p) => p.id === value) ?? null;

  return (
    <Combobox.Root
      items={products}
      value={selected}
      onValueChange={(next) => onChange((next as ProductOption | null)?.id ?? "")}
      itemToStringLabel={(p: ProductOption) => `${p.code} — ${p.name}`}
      isItemEqualToValue={(a: ProductOption, b: ProductOption) => a.id === b.id}
      filter={(p: ProductOption, query: string) => {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const haystack = haystacks.get(p.id) ?? "";
        return words.every((w) => haystack.includes(w));
      }}
      limit={50}
      disabled={disabled}
    >
      <div className={cn("relative", className)}>
        <Combobox.Input
          placeholder={placeholder}
          className="h-9 w-full rounded-md border bg-transparent px-3 pr-8 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Combobox.Trigger
          aria-label="Show products"
          className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground"
        >
          <ChevronsUpDown className="h-4 w-4" />
        </Combobox.Trigger>
      </div>

      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="z-50">
          <Combobox.Popup className="max-h-80 w-(--anchor-width) min-w-72 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <Combobox.Empty className="px-2 py-3 text-center text-sm text-muted-foreground empty:hidden">
              Nothing in the catalog matches that.
            </Combobox.Empty>
            <Combobox.List>
              {(p: ProductOption) => (
                <Combobox.Item
                  key={p.id}
                  value={p}
                  className="cursor-default rounded-md px-2 py-1.5 outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="block text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{p.code}</span>{" "}
                    {p.name}
                  </span>
                  {(p.description || p.subcategory) && (
                    <span className="block truncate text-micro text-muted-foreground">
                      {[p.subcategory?.name, p.description].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
