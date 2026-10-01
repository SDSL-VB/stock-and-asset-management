"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Clock, Loader2, MapPin, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { findStock, type FoundStock, type SiteStockRow } from "@/lib/actions/racks";
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

/* ------------------------------------------------------------------------- */
/* Recent searches                                                           */
/* ------------------------------------------------------------------------- */

/**
 * What this person searched for lately, kept in their own browser.
 *
 * Browser storage rather than the database because it is a convenience for one
 * person on one device — nobody else needs to see it and nothing on the server
 * reads it. It can also be missing or blocked (a private window, cleared site
 * data), so every read and write is wrapped and the page works without it.
 *
 * Read through useSyncExternalStore so the server render and the first client
 * render agree (both empty) and the list appears straight after, with no
 * hydration mismatch and no setState-in-an-effect.
 */
const RECENT_KEY = "find-stock:recent";
const RECENT_MAX = 8;
const recentListeners = new Set<() => void>();

function readRecentRaw(): string {
  try {
    return window.localStorage.getItem(RECENT_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

/**
 * Parsed defensively: storage is outside this code's control, so anything that
 * is not a short list of short strings is treated as empty rather than trusted.
 */
function parseRecent(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 100)
      .slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function writeRecent(list: string[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Storage blocked — the list simply does not persist
  }
  recentListeners.forEach((notify) => notify());
}

function subscribeRecent(notify: () => void) {
  recentListeners.add(notify);
  window.addEventListener("storage", notify);
  return () => {
    recentListeners.delete(notify);
    window.removeEventListener("storage", notify);
  };
}

function useRecentSearches() {
  const raw = useSyncExternalStore(subscribeRecent, readRecentRaw, () => "[]");
  const recent = useMemo(() => parseRecent(raw), [raw]);

  /**
   * Remember a search. A query that extends an earlier one replaces it, so
   * typing "cap", "capa", "capacitor" leaves one entry, not three.
   */
  function remember(query: string) {
    const term = query.trim();
    if (term.length < 2) return;
    const lower = term.toLowerCase();
    const kept = recent.filter((old) => {
      const o = old.toLowerCase();
      return o !== lower && !lower.startsWith(o);
    });
    writeRecent([term, ...kept].slice(0, RECENT_MAX));
  }

  function forget(term: string) {
    writeRecent(recent.filter((old) => old !== term));
  }

  return { recent, remember, forget, clear: () => writeRecent([]) };
}

export function StockFinder({
  initialQuery,
  categories,
  locations,
  siteStock,
}: {
  initialQuery: string;
  categories: { id: string; name: string }[];
  /** Only the sites this person may see — the server decides that list */
  locations: { id: string; name: string }[];
  /** What is on the shelves at this person's own site; no site means none */
  siteStock: { site: { id: string; name: string } | null; rows: SiteStockRow[]; truncated: boolean };
}) {
  const { recent, remember, forget, clear } = useRecentSearches();
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
        remember(value);
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

      {/* Before anything is typed: what was looked for lately, and what is on
          the shelves here. Both give way to the answer once there is a search. */}
      {results === null && !searching && (
        <>
          {recent.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-caption font-semibold text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  Recent searches
                </p>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clear}>
                  Clear
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recent.map((term) => (
                  <span
                    key={term}
                    className="inline-flex items-center rounded-full border bg-muted/40 text-sm"
                  >
                    <button
                      type="button"
                      className="px-3 py-1 hover:text-primary"
                      onClick={() => {
                        setQuery(term);
                        search(term);
                      }}
                    >
                      {term}
                    </button>
                    <button
                      type="button"
                      aria-label={`Forget "${term}"`}
                      className="pr-2 text-muted-foreground hover:text-destructive"
                      onClick={() => forget(term)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <SiteStock siteStock={siteStock} />
        </>
      )}

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

/**
 * What is on the shelves at the person's own site: code, item, how much is free
 * and which rack. The short form of the stock report — no value, no receipts,
 * no batches, which the report and the rack view already carry.
 *
 * With no site it says so and shows nothing: there is no "here" to list, and
 * the search box above is how that person finds anything.
 */
function SiteStock({
  siteStock,
}: {
  siteStock: { site: { id: string; name: string } | null; rows: SiteStockRow[]; truncated: boolean };
}) {
  const [filter, setFilter] = useState("");

  if (!siteStock.site) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 p-4 text-sm text-muted-foreground">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            You are not attached to a site, so nothing is listed here. Search for what you
            need above — the answer covers every site you can see.
          </p>
        </CardContent>
      </Card>
    );
  }

  const f = filter.trim().toLowerCase();
  const shown = f
    ? siteStock.rows.filter(
        (r) =>
          r.code.toLowerCase().includes(f) ||
          r.name.toLowerCase().includes(f) ||
          r.racks.some((rack) => rack.toLowerCase().includes(f))
      )
    : siteStock.rows;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">
            On the shelves at {siteStock.site.name}
            <span className="ml-1.5 font-normal text-muted-foreground">
              {siteStock.rows.length} item{siteStock.rows.length === 1 ? "" : "s"}
            </span>
          </p>
          {siteStock.rows.length > 8 && (
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Narrow this list — code, item or rack"
              className="h-8 max-w-xs"
            />
          )}
        </div>

        {siteStock.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is free at {siteStock.site.name} right now.</p>
        ) : (
          <div className="max-h-[28rem] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 text-left text-caption text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Free</th>
                  <th className="px-3 py-2 font-medium">Rack</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.productId} className="border-t">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.code}</td>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">
                      {qty(r.available)} {r.unit}
                    </td>
                    <td className="px-3 py-2">
                      {r.racks.length === 0 ? (
                        <span className="text-xs text-muted-foreground">not recorded</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {r.racks.map((rack) => (
                            <span
                              key={rack}
                              title={rackLabel(rack)}
                              className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-xs font-semibold"
                            >
                              {rack}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {siteStock.truncated && (
          <p className="text-xs text-muted-foreground">
            Showing the first {siteStock.rows.length}. Search above to find anything else.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
