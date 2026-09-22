"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { findStock, type FoundStock } from "@/lib/actions/racks";
import { rackLabel } from "@/lib/racks";

/**
 * The search box and the answer. Each product shows how much is free in
 * total, then per site the racks it is on, nearest-numbered first, with the
 * entries (and batches) on each. A product with none free says so plainly —
 * that is an answer too.
 */

function qty(n: number) {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function StockFinder({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<FoundStock[] | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function search(value: string) {
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) {
      setResults(null);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await findStock(value));
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
      <div className="relative max-w-xl">
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

      {results !== null && results.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing in the catalog matches that.</p>
      )}

      {results?.map((p) => (
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
