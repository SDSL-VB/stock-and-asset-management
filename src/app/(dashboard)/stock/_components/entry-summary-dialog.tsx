"use client";

import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight, ShieldCheck } from "lucide-react";

type SummaryEntry = {
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
  invoiceNumber: string | null;
  batchNumber: string | null;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
  createdAt: Date;
  location: { id: string; name: string; code: string } | null;
  department: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
  product: { id: string; code: string; name: string; category: { name: string } } | null;
  client: {
    id: string;
    name: string;
    city: string;
    gstNumber: string | null;
    address: string | null;
  } | null;
  clientLocation: string | null;
  warranty: {
    purchaseDate: Date;
    modelNumber: string;
    serialNumber: string;
    modelName: string | null;
    warrantyTill: Date;
    notes: string | null;
  } | null;
  issues: Array<{ id: string; quantity: number; department: { name: string } }>;
  _count: { attachments: number; approvals: number };
};

const STATUS_STYLES: Record<SummaryEntry["status"], string> = {
  DRAFT: "bg-gray-100 text-gray-700 border-gray-200",
  SUBMITTED: "bg-amber-50 text-amber-700 border-amber-200",
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{children}</p>
    </div>
  );
}

function date(d: Date | string) {
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Everything captured on an entry, without leaving the list. Built like the
 * dispatch detail dialog so the two read the same way.
 *
 * Money is only passed in when the viewer holds stock.value.view, and warranty
 * only when they hold stock.warranty.view — the caller decides, this just
 * renders what it is given.
 */
export function EntrySummaryDialog({
  entry,
  onClose,
  canSeeValue = false,
  canSeeWarranty = false,
}: {
  entry: SummaryEntry | null;
  onClose: () => void;
  canSeeValue?: boolean;
  canSeeWarranty?: boolean;
}) {
  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {entry && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{entry.entryNumber}</span>
                <Badge variant="outline" className={STATUS_STYLES[entry.status]}>
                  {entry.status.charAt(0) + entry.status.slice(1).toLowerCase()}
                </Badge>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <p className="text-base font-semibold">{entry.itemName}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {entry.itemCode ?? "—"}
                  {entry.product?.category?.name ? ` · ${entry.product.category.name}` : ""}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Row label="Vendor">{entry.supplierName}</Row>
                {/* The vendor above is whoever originally supplied the goods,
                    which for transferred stock is not who this site dealt with */}
                {entry.source !== "PURCHASED" && (
                  <Row label="How it got here">
                    {entry.source === "BUILT"
                      ? "Built in-house"
                      : "Transferred from another site"}
                  </Row>
                )}
                <Row label="Invoice">{entry.invoiceNumber || "—"}</Row>
                <Row label="Quantity">{entry.quantity}</Row>
                {canSeeValue && (
                  <Row label="Total">₹{entry.totalPrice.toLocaleString("en-IN")}</Row>
                )}
                <Row label="Batch">
                  {entry.batchNumber ? (
                    <span className="font-mono">{entry.batchNumber}</span>
                  ) : (
                    <span className="font-normal text-muted-foreground">Not set</span>
                  )}
                </Row>
                <Row label="Location">{entry.location?.name ?? "Not set"}</Row>
                <Row label="Created by">{entry.createdBy.name}</Row>
                <Row label="Date">{date(entry.createdAt)}</Row>
              </div>

              {/* A direct-to-client entry: the site is recorded above, the
                  customer is the point of it. */}
              {entry.client && (
                <div className="rounded-lg border bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">Ships directly to</p>
                  <p className="text-sm font-medium">{entry.client.name}</p>
                  <p className="text-xs text-muted-foreground">{entry.client.city}</p>
                  {entry.client.gstNumber && (
                    <p className="mt-1 font-mono text-xs">GST: {entry.client.gstNumber}</p>
                  )}
                  {entry.client.address && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {entry.client.address}
                    </p>
                  )}
                </div>
              )}

              {canSeeWarranty && entry.warranty && (
                <div className="rounded-lg border p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Warranty &amp; registration
                  </p>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Row label="Bought">{date(entry.warranty.purchaseDate)}</Row>
                    <Row label="Warranty till">{date(entry.warranty.warrantyTill)}</Row>
                    <Row label="Model no.">{entry.warranty.modelNumber}</Row>
                    <Row label="Serial no.">
                      <span className="font-mono">{entry.warranty.serialNumber}</span>
                    </Row>
                    {entry.warranty.modelName && (
                      <Row label="Model name">{entry.warranty.modelName}</Row>
                    )}
                  </div>
                  {entry.warranty.notes && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {entry.warranty.notes}
                    </p>
                  )}
                </div>
              )}

              {entry.issues.length > 0 && (
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Moved to</p>
                  <div className="flex flex-wrap gap-1.5">
                    {entry.issues.map((i) => (
                      <Badge key={i.id} variant="outline">
                        {i.quantity} → {i.department.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between border-t pt-3">
                <p className="text-xs text-muted-foreground">
                  {entry._count.attachments} document
                  {entry._count.attachments === 1 ? "" : "s"} ·{" "}
                  {entry._count.approvals} approval step
                  {entry._count.approvals === 1 ? "" : "s"}
                </p>
                <Link
                  href={`/stock/${entry.id}`}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  Open full entry
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
