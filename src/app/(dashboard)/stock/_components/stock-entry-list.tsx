"use client";

import { type ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Eye,
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  Paperclip,
  ArrowRightLeft,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { EntrySummaryDialog } from "./entry-summary-dialog";
import { QuickDocsDialog } from "./quick-docs-dialog";
import {
  EntryFilters,
  SOURCE_LABEL,
  sourceOf,
  type Filters,
} from "./entry-filters";
import { KIND_LABEL } from "@/lib/vocabulary";
import { heldQuantity } from "@/lib/stock-availability";

/**
 * How much of an entry is still standing where it says it is.
 *
 * The one function in `stock-availability.ts` that every surface has to use —
 * the list once showed the raw quantity, which counted stock at the site it
 * left and the site it arrived at simultaneously.
 */
function leftOf(entry: StockEntry): number {
  return heldQuantity(entry);
}

/** Distinct options, in the order they first appear, dropping the empty ones. */
function uniqueOptions(
  values: ({ value: string; label: string } | null)[]
): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const item of values) {
    if (item && !seen.has(item.value)) seen.set(item.value, item.label);
  }
  return [...seen].map(([value, label]) => ({ value, label }));
}

type StockEntry = {
  id: string;
  entryNumber: string;
  itemCode: string | null;
  itemName: string;
  supplierName: string;
  /** Bought in, built here, or sent from another site */
  source: "PURCHASED" | "BUILT" | "TRANSFERRED";
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  location: { id: string; name: string; code: string } | null;
  clientName: string | null;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
  createdAt: Date;
  department: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
  issues: Array<{ id: string; departmentId: string; quantity: number; department: { name: string } }>;
  // The other three claims on this entry. All four together are what is gone.
  transferRequests: Array<{ quantity: number }>;
  dispatchItems: Array<{ quantity: number }>;
  buildConsumptions: Array<{ quantity: number }>;
  invoiceNumber: string | null;
  batchNumber: string | null;
  isAsset: boolean;
  purchaseOrderLineId: string | null;
  product: {
    id: string;
    code: string;
    name: string;
    kind: "RAW" | "FINISHED" | "KIT";
    category: { id: string; name: string };
  } | null;
  client: { id: string; name: string; city: string; gstNumber: string | null; address: string | null } | null;
  clientLocation: string | null;
  warranty: {
    purchaseDate: Date;
    modelNumber: string;
    serialNumber: string;
    modelName: string | null;
    warrantyTill: Date;
    notes: string | null;
  } | null;
  attachments?: Array<{ id: string; fileName: string; fileUrl: string; mimeType: string; attachmentType: string }>;
  _count: { attachments: number; approvals: number };
};

interface Props {
  entries: StockEntry[];
  stats: {
    total: number;
    drafts: number;
    submitted: number;
    approved: number;
    rejected: number;
  };
  /** Warranty details are their own grant (stock.warranty.view) */
  canSeeWarranty?: boolean;
  /** Hides all monetary columns when false (stock.value.view) */
  canSeeValue?: boolean;
  /** Read from the URL by the page, so a shared link opens the same view */
  initialFilters?: {
    status?: string;
    source?: string;
    kind?: string;
    category?: string;
    site?: string;
    holding?: string;
  };
}

const statusConfig = {
  DRAFT: { label: "Draft", variant: "secondary" as const, icon: FileText },
  SUBMITTED: { label: "Pending", variant: "default" as const, icon: Clock },
  APPROVED: { label: "Approved", variant: "default" as const, icon: CheckCircle },
  REJECTED: { label: "Rejected", variant: "destructive" as const, icon: XCircle },
};

function StatusBadge({ status }: { status: keyof typeof statusConfig }) {
  const config = statusConfig[status];
  const colorClasses = {
    DRAFT: "bg-gray-100 text-gray-700 border-gray-200",
    SUBMITTED: "bg-amber-50 text-amber-700 border-amber-200",
    APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    REJECTED: "bg-red-50 text-red-700 border-red-200",
  };

  return (
    <Badge variant="outline" className={colorClasses[status]}>
      {config.label}
    </Badge>
  );
}

function buildColumns(
  onOpenSummary: (e: StockEntry) => void,
  onOpenDocs: (e: StockEntry) => void
): ColumnDef<StockEntry>[] {
  return [
  {
    accessorKey: "entryNumber",
    header: "Entry #",
    cell: ({ row }) => (
      <span className="font-mono text-sm font-medium">
        {row.original.entryNumber}
      </span>
    ),
  },
  {
    accessorKey: "itemName",
    header: "Item",
    cell: ({ row }) => (
      <div>
        <p className="font-medium">{row.original.itemName}</p>
        <p className="text-xs text-muted-foreground">
          {row.original.itemCode && (
            <span className="font-mono">{row.original.itemCode} · </span>
          )}
          {row.original.supplierName}
        </p>
        {/* Transferred stock keeps the origin's vendor name, so without this it
            reads as a purchase this site never made. */}
        {row.original.source === "TRANSFERRED" && (
          <span className="mt-1 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <ArrowRightLeft className="h-3 w-3" />
            Transferred in
          </span>
        )}
      </div>
    ),
  },
  {
    id: "location",
    header: "Location",
    cell: ({ row }) => {
      const labels = { HYDERABAD: "Hyderabad", BENGALURU: "Bengaluru", CLIENT: "Client" };
      return (
        <div>
          <p className="text-sm">{row.original.location?.name ?? "Unassigned"}</p>
          {row.original.clientName && (
            <p className="text-xs text-muted-foreground">{row.original.clientName}</p>
          )}
        </div>
      );
    },
  },
  {
    id: "department",
    header: "Department",
    cell: ({ row }) => {
      const issued = row.original.issues;
      if (issued.length > 0) {
        const names = [...new Set(issued.map((i) => i.department.name))];
        return <span className="text-sm">{names.join(", ")}</span>;
      }
      return (
        <span className="text-sm text-muted-foreground">
          {row.original.department?.name ??
            `Central Stock (${row.original.location?.name ?? "Unassigned"})`}
        </span>
      );
    },
  },
  {
    id: "quantity",
    header: "Here now",
    // What is LEFT, not what arrived. An entry whose goods have been dispatched
    // to another site, issued to a department or eaten by a build still has its
    // original quantity on it — showing that number counted the same PC at both
    // ends of a transfer.
    accessorFn: (entry) => leftOf(entry),
    cell: ({ row }) => {
      const left = leftOf(row.original);
      const arrived = row.original.quantity;
      return (
        <div>
          <p className="font-medium">{left}</p>
          {left !== arrived && (
            <p className="text-xs text-muted-foreground">of {arrived} received</p>
          )}
        </div>
      );
    },
  },
  {
    id: "totalPrice",
    header: "Value here",
    // The value of what is still standing here, for the same reason. What the
    // whole consignment cost is on the entry itself.
    accessorFn: (entry) => leftOf(entry) * entry.unitPrice,
    cell: ({ row }) => (
      <span className="font-medium">
        {new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: "INR",
        }).format(leftOf(row.original) * row.original.unitPrice)}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    id: "attachments",
    header: "Docs",
    cell: ({ row }) => {
      const count = row.original._count.attachments;
      if (count === 0) {
        return (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" />0
          </span>
        );
      }
      // Opens the document straight away instead of routing through the entry
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenDocs(row.original);
          }}
          className="flex items-center gap-1 rounded px-1 text-sm font-medium text-brand-blue hover:underline"
          title={`Open ${count === 1 ? "the document" : "documents"}`}
        >
          <Paperclip className="h-3.5 w-3.5" />
          {count}
        </button>
      );
    },
  },
  {
    accessorKey: "createdBy.name",
    header: "Created By",
  },
  {
    accessorKey: "createdAt",
    header: "Date",
    cell: ({ row }) =>
      new Date(row.original.createdAt).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
  },
  {
    id: "actions",
    // The row itself opens the quick summary; this goes straight to the whole
    // entry. A real link rather than a button, so middle-click and ctrl-click
    // open it in a tab like any other link.
    cell: ({ row }) => (
      <Button
        variant="ghost"
        size="sm"
        render={
          <Link
            href={`/stock/${row.original.id}`}
            onClick={(e) => e.stopPropagation()}
            title="Open the full entry"
            aria-label={`Open ${row.original.entryNumber}`}
          />
        }
        nativeButton={false}
      >
        <Eye className="h-4 w-4" />
      </Button>
    ),
  },
  ];
}

type StatusFilter = "ALL" | "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

const STATUSES: StatusFilter[] = ["ALL", "DRAFT", "SUBMITTED", "APPROVED", "REJECTED"];

/** A URL value, only if it is one this filter actually accepts. */
function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function StockEntryList({
  entries,
  stats,
  canSeeValue = true,
  canSeeWarranty = false,
  initialFilters,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  // Starting state comes from the URL, so a shared link opens the same view.
  // Anything unrecognised falls back to "no filter" rather than showing an
  // empty table for a typo.
  const [filter, setFilter] = useState<StatusFilter>(
    oneOf(initialFilters?.status, STATUSES, "ALL")
  );
  const [filters, setFilters] = useState<Filters>({
    source: oneOf(initialFilters?.source, ["ALL", "FRESH", "ORDER", "BUILT", "TRANSFERRED"] as const, "ALL"),
    kind: oneOf(initialFilters?.kind, ["ALL", "RAW", "FINISHED", "KIT"] as const, "ALL"),
    category: initialFilters?.category ?? "ALL",
    site: initialFilters?.site ?? "ALL",
    holding: oneOf(initialFilters?.holding, ["ALL", "STOCK", "ASSET"] as const, "ALL"),
  });
  const [summaryEntry, setSummaryEntry] = useState<StockEntry | null>(null);
  const [docsEntry, setDocsEntry] = useState<StockEntry | null>(null);

  const allColumns = buildColumns(setSummaryEntry, setDocsEntry);

  // Monetary visibility is a permission (stock.value.view)
  const columns = canSeeValue
    ? allColumns
    : allColumns.filter((c) => ("accessorKey" in c ? c.accessorKey !== "totalPrice" : true));

  /**
   * Mirror the current view into the URL. `replace` rather than `push` so the
   * back button leaves the page instead of walking back through every dropdown
   * change, and `scroll: false` so the table does not jump to the top.
   */
  function syncUrl(status: StatusFilter, next: Filters) {
    const params = new URLSearchParams();
    if (status !== "ALL") params.set("status", status);
    if (next.source !== "ALL") params.set("source", next.source);
    if (next.kind !== "ALL") params.set("kind", next.kind);
    if (next.category !== "ALL") params.set("category", next.category);
    if (next.site !== "ALL") params.set("site", next.site);
    if (next.holding !== "ALL") params.set("holding", next.holding);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function changeStatus(status: StatusFilter) {
    setFilter(status);
    syncUrl(status, filters);
  }

  function changeFilters(next: Filters) {
    setFilters(next);
    syncUrl(filter, next);
  }

  // The choices on offer, built from everything this person can see — never
  // from the filtered list, or the options would vanish as you use them.
  const options = {
    kinds: uniqueOptions(
      entries.map((e) => e.product && { value: e.product.kind, label: KIND_LABEL[e.product.kind] })
    ),
    sources: uniqueOptions(
      entries.map((e) => ({ value: sourceOf(e), label: SOURCE_LABEL[sourceOf(e)] }))
    ),
    categories: uniqueOptions(
      entries.map((e) => e.product && { value: e.product.category.id, label: e.product.category.name })
    ),
    sites: uniqueOptions(
      entries.map((e) => e.location && { value: e.location.id, label: e.location.name })
    ),
    holdings: uniqueOptions(
      entries.map((e) => ({
        value: e.isAsset ? "ASSET" : "STOCK",
        label: e.isAsset ? "Assets only" : "Stock only",
      }))
    ),
  };

  const filtered = entries.filter((e) => {
    if (filter !== "ALL" && e.status !== filter) return false;
    if (filters.source !== "ALL" && sourceOf(e) !== filters.source) return false;
    if (filters.kind !== "ALL" && e.product?.kind !== filters.kind) return false;
    if (filters.category !== "ALL" && e.product?.category.id !== filters.category) return false;
    if (filters.site !== "ALL" && e.location?.id !== filters.site) return false;
    if (filters.holding !== "ALL" && (e.isAsset ? "ASSET" : "STOCK") !== filters.holding) return false;
    return true;
  });

  // How many the status tab alone would show, so "showing 3 of 9" compares
  // like with like rather than against the whole company's stock.
  const beforeFilters =
    filter === "ALL" ? entries.length : entries.filter((e) => e.status === filter).length;

  const tabs: { key: StatusFilter; label: string; count: number }[] = [
    { key: "ALL", label: "All", count: stats.total },
    { key: "DRAFT", label: "Drafts", count: stats.drafts },
    { key: "SUBMITTED", label: "Pending", count: stats.submitted },
    { key: "APPROVED", label: "Approved", count: stats.approved },
    { key: "REJECTED", label: "Rejected", count: stats.rejected },
  ];

  return (
    <div className="space-y-4">
      {/* Stat tabs */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
        {tabs.map((tab) => (
          <Card
            key={tab.key}
            className={`cursor-pointer transition-all ${
              filter === tab.key
                ? "border-brand-green ring-1 ring-brand-green/30"
                : "hover:border-muted-foreground/30"
            }`}
            onClick={() => changeStatus(tab.key)}
          >
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold">{tab.count}</p>
              <p className="text-xs text-muted-foreground">{tab.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <EntryFilters
        filters={filters}
        onChange={changeFilters}
        options={options}
        showing={filtered.length}
        total={beforeFilters}
      />

      <DataTable
        columns={columns}
        data={filtered}
        searchKey="itemName"
        searchPlaceholder="Search by item name, supplier, entry number..."
        // Clicking the row itself gives the quick summary; the eye at the end
        // of the row goes to the whole entry.
        onRowClick={setSummaryEntry}
      />

      <EntrySummaryDialog
        entry={summaryEntry}
        onClose={() => setSummaryEntry(null)}
        canSeeValue={canSeeValue}
        canSeeWarranty={canSeeWarranty}
      />
      <QuickDocsDialog
        entryNumber={docsEntry?.entryNumber ?? null}
        attachments={docsEntry?.attachments ?? []}
        onClose={() => setDocsEntry(null)}
      />
    </div>
  );
}
