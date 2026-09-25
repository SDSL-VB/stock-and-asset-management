"use client";

import { useMemo, useState } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pick one thing from a list by typing any part of it.
 *
 * Called by: the product form, for its category and subcategory. Both use the
 * same control on purpose — they are the same kind of question, and a catalog
 * that grows past a screenful makes scrolling a dropdown the slow way to
 * answer either of them.
 *
 * What it adds over a plain <Select>:
 *
 *   search      every word typed has to match somewhere, in any order, so
 *               "res 12k" and "12k res" both find the same thing
 *   a way out   when nothing matches, the popup offers the next step rather
 *               than a dead end — add it, or ask for it — carrying whatever
 *               was typed, so the name is not retyped
 *
 * The value is an id (or "" for none), which is what the forms store, so this
 * drops in wherever a <Select> of ids used to be.
 */

export type PickerItem = {
  value: string;
  label: string;
  /** A second line: a code, a description, whatever tells two apart */
  hint?: string | null;
  /** Extra words the search should match but the list need not show */
  keywords?: string | null;
};

export function SearchableSelect({
  items,
  value,
  onChange,
  placeholder = "Search…",
  emptyLabel = "Nothing matches that.",
  emptyActions,
  disabled = false,
  ariaLabel,
  className,
}: {
  items: PickerItem[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Shown above the actions when the search finds nothing */
  emptyLabel?: string;
  /**
   * Offered when nothing matches. Each is given whatever was typed, so "Add
   * subcategory" can arrive with the name already filled in.
   */
  emptyActions?: { label: (query: string) => string; onSelect: (query: string) => void }[];
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");

  const haystacks = useMemo(
    () =>
      new Map(
        items.map((item) => [
          item.value,
          [item.label, item.hint, item.keywords].filter(Boolean).join(" ").toLowerCase(),
        ])
      ),
    [items]
  );
  const selected = items.find((item) => item.value === value) ?? null;

  return (
    <Combobox.Root
      items={items}
      value={selected}
      onValueChange={(next) => onChange((next as PickerItem | null)?.value ?? "")}
      onInputValueChange={setQuery}
      itemToStringLabel={(item: PickerItem) => item.label}
      isItemEqualToValue={(a: PickerItem, b: PickerItem) => a.value === b.value}
      filter={(item: PickerItem, text: string) => {
        const words = text.toLowerCase().split(/\s+/).filter(Boolean);
        const haystack = haystacks.get(item.value) ?? "";
        return words.every((w) => haystack.includes(w));
      }}
      limit={50}
      disabled={disabled}
    >
      <div className={cn("relative", className)}>
        <Combobox.Input
          aria-label={ariaLabel}
          placeholder={placeholder}
          className="h-9 w-full rounded-md border bg-transparent px-3 pr-8 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Combobox.Trigger
          aria-label="Show the list"
          className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground"
        >
          <ChevronsUpDown className="h-4 w-4" />
        </Combobox.Trigger>
      </div>

      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="z-50">
          <Combobox.Popup className="max-h-80 w-(--anchor-width) min-w-72 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <Combobox.Empty className="space-y-1 px-2 py-3 text-sm empty:hidden">
              <p className="text-center text-muted-foreground">{emptyLabel}</p>
              {/* onMouseDown, not onClick: the popup closes on blur, and a
                  click that lands after it closes never reaches the button. */}
              {emptyActions?.map((action) => (
                <button
                  key={action.label("")}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    action.onSelect(query.trim());
                  }}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  {action.label(query.trim())}
                </button>
              ))}
            </Combobox.Empty>
            <Combobox.List>
              {(item: PickerItem) => (
                <Combobox.Item
                  key={item.value}
                  value={item}
                  className="cursor-default rounded-md px-2 py-1.5 outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span className="block text-sm">{item.label}</span>
                  {item.hint && (
                    <span className="block truncate text-micro text-muted-foreground">{item.hint}</span>
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
