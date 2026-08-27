"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { labelOfKind, KIND_BADGE } from "@/lib/vocabulary";
import { Search, ChevronRight, Package, Wrench, Boxes, Clock } from "lucide-react";

type CatalogProduct = {
  id: string;
  code: string;
  name: string;
  kind: string;
  unit: string;
  category: { id: string; name: string; codePrefix: string | null };
  bom: { version: number; lineCount: number; updatedAt: Date } | null;
  pendingVersion: number | null;
  usedInCount: number;
};

interface Props {
  products: CatalogProduct[];
  canEdit: boolean;
  canCreate: boolean;
  canApprove: boolean;
}

const KIND_ICONS: Record<string, typeof Package> = {
  RAW: Package,
  FINISHED: Wrench,
  KIT: Boxes,
};

const KIND_FILTER_ITEMS = [
  { value: "all", label: "Any kind" },
  { value: "RAW", label: "Raw materials" },
  { value: "FINISHED", label: "Finished products" },
  { value: "KIT", label: "Kits" },
];

const STATE_FILTER_ITEMS = [
  { value: "all", label: "All products" },
  { value: "has", label: "Has a bill of materials" },
  { value: "pending", label: "Waiting for approval" },
  { value: "none", label: "None yet" },
];

/**
 * Products grouped by category, because that is how the paper sheets are
 * organised and how people ask for them ("the BLDC ones").
 */
export function BomCatalog({ products, canEdit, canCreate, canApprove }: Props) {
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (kindFilter !== "all" && p.kind !== kindFilter) return false;
      if (stateFilter === "has" && !p.bom) return false;
      if (stateFilter === "pending" && !p.pendingVersion) return false;
      if (stateFilter === "none" && (p.bom || p.pendingVersion)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.category.name.toLowerCase().includes(q)
      );
    });
  }, [products, search, kindFilter, stateFilter]);

  const groups = useMemo(() => {
    const byCategory = new Map<string, { name: string; items: CatalogProduct[] }>();
    for (const p of filtered) {
      const existing = byCategory.get(p.category.id);
      if (existing) existing.items.push(p);
      else byCategory.set(p.category.id, { name: p.category.name, items: [p] });
    }
    return [...byCategory.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered]);

  const withBoms = products.filter((p) => p.bom).length;
  const waiting = products.filter((p) => p.pendingVersion).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by product, code or category"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={kindFilter}
          items={KIND_FILTER_ITEMS}
          onValueChange={(v) => setKindFilter((v as string) ?? "all")}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Any kind" />
          </SelectTrigger>
          <SelectContent>
            {KIND_FILTER_ITEMS.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={stateFilter}
          items={STATE_FILTER_ITEMS}
          onValueChange={(v) => setStateFilter((v as string) ?? "all")}
        >
          <SelectTrigger className="w-[210px]">
            <SelectValue placeholder="All products" />
          </SelectTrigger>
          <SelectContent>
            {STATE_FILTER_ITEMS.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span>
          {withBoms} of {products.length} products have a bill of materials.
        </span>
        {canApprove && waiting > 0 && (
          <button
            type="button"
            onClick={() => setStateFilter("pending")}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-caption font-medium text-amber-900 transition-colors hover:bg-amber-100"
          >
            <Clock className="h-3.5 w-3.5" />
            {waiting} waiting for your approval
          </button>
        )}
        <span>
          {canCreate || canEdit
            ? "Open one to see or change what it is made of."
            : "Open one to see what it is made of."}
        </span>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          emoji="🔍"
          title="Nothing matches"
          description="Try a different search or clear the filters."
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.name} className="space-y-2">
              <h3 className="text-caption font-bold uppercase tracking-[0.1em] text-muted-foreground">
                {group.name}
                <span className="ml-2 font-medium normal-case tracking-normal">
                  {group.items.length} product{group.items.length === 1 ? "" : "s"}
                </span>
              </h3>
              <Card>
                <CardContent className="divide-y p-0">
                  {group.items.map((p) => {
                    const Icon = KIND_ICONS[p.kind] ?? Package;
                    return (
                      <Link
                        key={p.id}
                        href={`/bom/${p.id}`}
                        className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm text-muted-foreground">{p.code}</span>
                            <span className="truncate font-medium">{p.name}</span>
                            <Badge
                              variant="outline"
                              className={cn("text-micro", KIND_BADGE[p.kind as keyof typeof KIND_BADGE])}
                            >
                              {labelOfKind(p.kind)}
                            </Badge>
                            {p.pendingVersion !== null && (
                              <Badge
                                variant="outline"
                                className="border-amber-200 bg-amber-50 text-micro text-amber-900"
                              >
                                v{p.pendingVersion} awaiting approval
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-caption text-muted-foreground">
                            Measured in {p.unit}
                            {p.bom
                              ? ` · ${p.bom.lineCount} component${p.bom.lineCount === 1 ? "" : "s"} · version ${p.bom.version} in force`
                              : " · nothing published yet"}
                            {p.usedInCount > 0
                              ? ` · used in ${p.usedInCount} other${p.usedInCount === 1 ? "" : "s"}`
                              : ""}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </Link>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
