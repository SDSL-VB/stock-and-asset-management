"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { approveProductRequest, rejectProductRequest } from "@/lib/actions/products";
import { codePrefixOf, CODE_PREFIX_PATTERN } from "@/lib/product-codes";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";

/**
 * The request queue on the Catalog page.
 *
 * Someone who cannot change the catalog asks for a product or a category here,
 * and whoever can add it reviews the ask. Approving a product request is what
 * CREATES the product — there is no separate step afterwards.
 *
 * Everyone sees their own requests. Reviewers additionally see everyone's, for
 * the types they can review.
 */

export type CatalogRequest = {
  id: string;
  type: "PRODUCT" | "CATEGORY";
  name: string;
  notes: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewNote: string | null;
  createdAt: Date;
  category: { id: string; name: string } | null;
  requestedBy: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
};

export type ReviewCategory = {
  id: string;
  name: string;
  codePrefix: string | null;
  nextSequence: number;
};

interface Props {
  requests: CatalogRequest[];
  categories: ReviewCategory[];
  canReviewProducts: boolean;
  canReviewCategories: boolean;
  canOverrideCode: boolean;
  viewerId: string;
}

function StatusBadge({ status }: { status: CatalogRequest["status"] }) {
  const classes = {
    PENDING: "bg-amber-50 text-amber-700 border-amber-200",
    APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    REJECTED: "bg-red-50 text-red-700 border-red-200",
  };
  const labels = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected" };
  return (
    <Badge variant="outline" className={classes[status]}>
      {labels[status]}
    </Badge>
  );
}

export function CatalogRequests({
  requests,
  categories,
  canReviewProducts,
  canReviewCategories,
  canOverrideCode,
  viewerId,
}: Props) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asked for</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Asked by</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[170px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    Nothing has been asked for. Requests raised from the stock entry form
                    appear here.
                  </TableCell>
                </TableRow>
              ) : (
                requests.map((request) => {
                  const isMine = request.requestedBy.id === viewerId;
                  const canReview =
                    request.status === "PENDING" &&
                    (request.type === "PRODUCT" ? canReviewProducts : canReviewCategories);

                  return (
                    <TableRow key={request.id}>
                      <TableCell>
                        <p className="font-medium">{request.name}</p>
                        {request.notes && (
                          <p className="text-xs text-muted-foreground">{request.notes}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {request.type === "PRODUCT" ? "Product" : "Category"}
                        </Badge>
                      </TableCell>
                      <TableCell>{request.category?.name ?? "—"}</TableCell>
                      <TableCell>
                        {request.requestedBy.name}
                        {isMine && (
                          <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        {new Date(request.createdAt).toLocaleDateString("en-IN")}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <StatusBadge status={request.status} />
                          {request.status === "REJECTED" && request.reviewNote && (
                            <p className="text-xs text-red-600">{request.reviewNote}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {canReview && (
                          <ReviewActions
                            request={request}
                            categories={categories}
                            canOverrideCode={canOverrideCode}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewActions({
  request,
  categories,
  canOverrideCode: _canOverrideCode,
}: {
  request: CatalogRequest;
  categories: ReviewCategory[];
  canOverrideCode: boolean;
}) {
  const router = useRouter();
  const [approveOpen, setApproveOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [code, setCode] = useState("");
  // Category requests carry only a name, so the reviewer chooses the code the
  // new category will hand out. Nothing generates one.
  const [categoryCode, setCategoryCode] = useState("");
  const [name, setName] = useState(request.name);
  const [categoryId, setCategoryId] = useState(request.category?.id ?? "");
  const [reason, setReason] = useState("");

  const isProduct = request.type === "PRODUCT";
  // The prefix belongs to the category and is never typed — the reviewer only
  // supplies the half after it.
  const prefix = codePrefixOf(categories.find((c) => c.id === categoryId));

  async function handleApprove(e: React.FormEvent) {
    e.preventDefault();
    setApproving(true);
    try {
      const result = await approveProductRequest(request.id, {
        code: isProduct ? code.trim() : undefined,
        name: name.trim(),
        categoryId: isProduct ? categoryId : undefined,
        codePrefix: isProduct ? undefined : categoryCode.trim(),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(isProduct ? "Product added to the catalog" : `Category "${name}" created`);
      setApproveOpen(false);
      router.refresh();
    } finally {
      setApproving(false);
    }
  }

  async function handleReject(e: React.FormEvent) {
    e.preventDefault();
    setRejecting(true);
    try {
      const result = await rejectProductRequest(request.id, { reviewNote: reason.trim() });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Request declined");
      setRejectOpen(false);
      router.refresh();
    } finally {
      setRejecting(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        onClick={() => setApproveOpen(true)}
        className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
      >
        <Check className="mr-1 h-4 w-4" />
        Approve
      </Button>
      <Button variant="outline" size="sm" onClick={() => setRejectOpen(true)}>
        <X className="mr-1 h-4 w-4" />
        Decline
      </Button>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isProduct ? "Approve & add product" : "Approve & add category"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleApprove} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Asked for by {request.requestedBy.name}
              {request.notes ? ` — "${request.notes}"` : ""}
            </p>

            {isProduct && (
              <>
                <div className="space-y-2">
                  <Label>Category *</Label>
                  <Select
                    value={categoryId}
                    items={categories.map((c) => ({ value: c.id, label: c.name }))}
                    onValueChange={(v) => setCategoryId((v as string) ?? "")}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`code-${request.id}`}>Product code *</Label>
                  <div className="flex items-stretch rounded-md border focus-within:ring-2 focus-within:ring-ring">
                    <span className="flex select-none items-center rounded-l-md border-r bg-muted px-3 font-mono text-sm font-semibold text-muted-foreground">
                      {prefix ?? "—"}
                    </span>
                    <Input
                      id={`code-${request.id}`}
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      placeholder={categoryId ? "TV55" : "Pick a category first"}
                      className="rounded-l-none border-0 font-mono shadow-none focus-visible:ring-0"
                      disabled={!categoryId}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {categoryId
                      ? `The code will be ${prefix ?? ""}${code || "…"}`
                      : "Choose a category and its code prefix fills in here."}
                  </p>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor={`name-${request.id}`}>
                {isProduct ? "Product name *" : "Category name *"}
              </Label>
              <Input
                id={`name-${request.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {!isProduct && (
              <div className="space-y-2">
                <Label htmlFor={`catcode-${request.id}`}>Category code *</Label>
                <Input
                  id={`catcode-${request.id}`}
                  value={categoryCode}
                  onChange={(e) => setCategoryCode(e.target.value)}
                  placeholder="e.g. 1001"
                  inputMode="numeric"
                  maxLength={4}
                  className="font-mono"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Exactly 4 digits, unused by any other category. Every product
                  code in it will start with this.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setApproveOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  approving ||
                  !name.trim() ||
                  (isProduct
                    ? !categoryId || !code.trim()
                    : !CODE_PREFIX_PATTERN.test(categoryCode.trim()))
                }
                className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
              >
                {approving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isProduct ? "Add to catalog" : "Create category"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline request</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleReject} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`decline-${request.id}`}>Reason *</Label>
              <Textarea
                id={`decline-${request.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this being declined?"
                rows={3}
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRejectOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={rejecting || !reason.trim()}>
                {rejecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Decline request
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
