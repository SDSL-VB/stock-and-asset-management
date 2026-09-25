"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { findStock, type FoundStock } from "@/lib/actions/racks";
import { FilterSelect } from "@/components/shared/filter-select";
import { formatCurrency } from "@/lib/format";
import { rackLabel } from "@/lib/racks";

/**
 * The search box, its filters, and the answer. Each product shows how much is
 * free in total, then per site the racks it is on, nearest-numbered first, with
 * the entries (and batches) on each. A product with none free says so plainly —
 * that is an answer too.
 *
 * The category and site dropdowns narrow the same search rather than filtering
 * what came back, so the counts stay true. The site list holds only the sites
 * this person may see; a location-scoped person sees no dropdown at all,
 * because their one site is not a choice.
 *
 * Two ways to read the answer. "Where it is" is the rack-by-rack detail above;
 * "How much there is" is the stock report's table for exactly the search in
 * front of you — one row per item, what is free, at which sites, and what it is
 * worth for whoever may see that. Same numbers, asked a different way round.
 */

function qty(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function StockFinder({
  initialQuery,
  categories,
  locations,
}: {
  initialQuery: string;
  categories: { id: string; name: string }[];
  /** Only the sites this person may see — the server decides that list */
  locations: { id: string; name: string }[];
}) {
  const [query, setQuery] = useState(initialQuery);
  const [categoryId, setCategoryId] = useState("ALL");
  const [locationId, setLocationId] = useState("ALL");
  // Where it is, or how much there is — the same question the stock report
  // answers, asked from the place people come to when they are looking for
  // something rather than counting it.
  const [view, setView] = useState<"racks" | "summary">("racks");
  const [results, setResults] = useState<FoundStock[] | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filterOf = (category: string, location: string) => ({
    categoryId: category === "ALL" ? undefined : category,
    locationId: location === "ALL" ? undefined : location,
  });

  function search(value: string, category = categoryId, location = locationId) {
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) {
      setResults(null);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await findStock(value, filterOf(category, location)));
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  // A link with ?q= arrives with its search already run
  useEffect(() => {
    if (!initialQuery) return;
    let current = true;
    findStock(initialQuery).then((found) => current && setResults(found));
    return () => {
      current = false;
    };
  }, [initialQuery]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1 sm:max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        <Input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            search(e.target.value);
          }}
          placeholder="Material name, code or description — e.g. control board"
          className="h-11 pl-9 text-base"
          autoComplete="off"
        />
        </div>

        {/* Narrow the answer without retyping the words. Only the sites this
            person may see are offered — the server builds that list. */}
        {categories.length > 1 && (
          <FilterSelect
            label="Category"
            value={categoryId}
            onChange={(next) => {
              setCategoryId(next);
              search(query, next, locationId);
            }}
            options={[
              { value: "ALL", label: "Any category" },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        )}

        {locations.length > 1 && (
          <FilterSelect
            label="Site"
            value={locationId}
            onChange={(next) => {
              setLocationId(next);
              search(query, categoryId, next);
            }}
            options={[
              { value: "ALL", label: "Any site" },
              ...locations.map((l) => ({ value: l.id, label: l.name })),
            ]}
          />
        )}

        {results !== null && results.length > 0 && (
          <FilterSelect
            label="Show"
            value={view}
            onChange={(next) => setView(next as "racks" | "summary")}
            options={[
              { value: "racks", label: "Where it is" },
              { value: "summary", label: "How much there is" },
            ]}
          />
        )}
      </div>

      {results !== null && results.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing in the catalog matches that.</p>
      )}

      {/* The stock report's answer, for the search in front of you: what was
          found, how much of it is free, where, and what it is worth. */}
      {view === "summary" && results && results.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-caption text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Kind</th>
                    <th className="px-3 py-2 text-right font-medium">Free</th>
                    <th className="px-3 py-2 font-medium">Where</th>
                    {results.some((p) => p.value !== null) && (
                      <th className="px-3 py-2 text-right font-medium">Value</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {results.map((p) => (
                    <tr key={p.productId} className="border-t align-top">
                      <td className="px-3 py-2">
                        <span className="font-medium">{p.name}</span>
                        <span className="block font-mono text-micro text-muted-foreground">{p.code}</span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{p.categoryName}</td>
                      <td className="px-3 py-2 text-muted-foreground">{p.kindLabel}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {qty(p.total)} {p.unit}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {p.sites.length === 0
                          ? "Nowhere — none in stock"
                          : p.sites
                              .map((s) => `${s.locationName} (${qty(s.total)})`)
                              .join(" · ")}
                      </td>
                      {results.some((r) => r.value !== null) && (
                        <td className="px-3 py-2 text-right tabular-nums">
                          {p.value === null ? "—" : formatCurrency(p.value)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/30">
                  <tr>
                    <td className="px-3 py-2 font-medium" colSpan={3}>
                      {results.length} item{results.length === 1 ? "" : "s"} found
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {qty(results.reduce((sum, p) => sum + p.total, 0))}
                    </td>
                    <td />
                    {results.some((r) => r.value !== null) && (
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {formatCurrency(results.reduce((sum, p) => sum + (p.value ?? 0), 0))}
                      </td>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {view === "racks" && results?.map((p) => (
        <Card key={p.productId}>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">
                  <span className="font-mono text-xs text-muted-foreground">{p.code}</span> {p.name}
                </p>
                <p className="text-micro text-muted-foreground">
                  {p.categoryName}
                  {p.description ? ` · ${p.description}` : ""}
                </p>
              </div>
              {p.total > 0 ? (
                <Badge variant="outline" className="text-sm">
                  {qty(p.total)} {p.unit} free
                </Badge>
              ) : (
                <Badge variant="outline" className="text-sm text-status-rejected">
                  None in stock
                </Badge>
              )}
            </div>

            {p.sites.map((site) => (
              <div key={site.locationId} className="space-y-1.5">
                <p className="text-caption font-semibold text-muted-foreground">
                  {site.locationName} · {qty(site.total)} {p.unit}
                </p>
                <ul className="divide-y rounded-md border">
                  {site.racks.map((r) => (
                    <li key={r.rack ?? "none"} className="flex flex-wrap items-center gap-3 px-3 py-2">
                      {r.rack ? (
                        <span className="flex items-center gap-2">
                          <span className="rounded-md bg-primary px-2.5 py-1 font-mono text-lg font-bold text-primary-foreground">
                            {r.rack}
                          </span>
                          <span className="text-sm">{rackLabel(r.rack)}</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-2 text-sm text-muted-foreground">
                          <MapPin className="h-4 w-4" />
                          No rack recorded
                        </span>
                      )}
                      <span className="ml-auto text-sm font-semibold tabular-nums">
                        {qty(r.available)} {p.unit}
                      </span>
                      <span className="w-full text-micro text-muted-foreground">
                        {r.entries.map((e, i) => (
                          <span key={e.id}>
                            {i > 0 && " · "}
                            <Link href={`/stock/${e.id}`} className="font-mono hover:text-primary hover:underline">
                              {e.entryNumber}
                            </Link>
                            {e.batchNumber ? ` batch ${e.batchNumber}` : ""} ({qty(e.available)})
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
