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
import { codeLeaderOf, categoryCodeError } from "@/lib/product-codes";
import { toast } from "sonner";
import { Check, Loader2, Search, X } from "lucide-react";
import { statusPill } from "@/lib/design/status";
import type { CatalogRules } from "@/lib/validations/product";

/**
 * The request queue on the Catalog page.
 *
 * Someone who cannot change the catalog asks for a product or a category here,
 * and whoever can add it reviews the ask. Approving a product request is what
 * CREATES the product — there is no separate step afterwards.
 *
 * Everyone sees their own requests. Reviewers additionally see everyone's, for
 * the types they can review — and the ones waiting on THEM are tinted, so a
 * new request stands out from the history around it.
 */

type CatalogRequest = {
  id: string;
  type: "PRODUCT" | "CATEGORY";
  name: string;
  /** What the asker suggested. The reviewer may change both. */
  description: string | null;
  notes: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewNote: string | null;
  createdAt: Date;
  category: { id: string; name: string } | null;
  subcategory: { id: string; name: string; code: string | null } | null;
  requestedBy: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
};

type ReviewCategory = {
  id: string;
  name: string;
  codePrefix: string | null;
  nextSequence: number;
  subcategories: { id: string; name: string; code: string | null }[];
};

interface Props {
  requests: CatalogRequest[];
  categories: ReviewCategory[];
  canReviewProducts: boolean;
  canReviewCategories: boolean;
  canOverrideCode: boolean;
  viewerId: string;
  /**
   * What the catalog insists on. The REVIEWER has to satisfy these, not the
   * asker — approving is what creates the product, so this is the form the
   * rules are enforced against.
   */
  rules: CatalogRules;
}

function StatusBadge({ status }: { status: CatalogRequest["status"] }) {
  const labels = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected" };
  return (
    <Badge variant="outline" className={statusPill(status)}>
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
  rules,
}: Props) {
  // Searchable like every other tab of the Catalog page: the queue grows and
  // "did anyone ask for this already?" is the question people arrive with.
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const shown = q
    ? requests.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q) ||
          (r.notes ?? "").toLowerCase().includes(q) ||
          r.requestedBy.name.toLowerCase().includes(q) ||
          (r.category?.name ?? "").toLowerCase().includes(q) ||
          r.status.toLowerCase().includes(q) ||
          (r.type === "PRODUCT" ? "product" : "category").includes(q)
      )
    : requests;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by what was asked for, who asked, category or status..."
              className="pl-9"
            />
          </div>
          {q && (
            <span className="text-sm text-muted-foreground">
              Showing {shown.length} of {requests.length}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asked for</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Asked by</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[170px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    {requests.length === 0
                      ? "Nothing has been asked for. Requests raised here or from the stock entry form appear here."
                      : "No request matches that."}
                  </TableCell>
                </TableRow>
              ) : (
                shown.map((request) => {
                  const isMine = request.requestedBy.id === viewerId;
                  const canReview =
                    request.status === "PENDING" &&
                    (request.type === "PRODUCT" ? canReviewProducts : canReviewCategories);

                  return (
                    <TableRow key={request.id} className={canReview ? "bg-status-pending-bg/60" : undefined}>
                      <TableCell>
                        <p className="font-medium">{request.name}</p>
                        {request.notes && (
                          <p className="text-xs text-muted-foreground">{request.notes}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        {/* A category request has no category of its own, so
                            the category is only shown for a product */}
                        <Badge variant="outline">
                          {request.type === "PRODUCT" ? "Product" : "New category"}
                        </Badge>
                        {request.type === "PRODUCT" && request.category && (
                          <span className="ml-1.5 text-xs text-muted-foreground">in {request.category.name}</span>
                        )}
                      </TableCell>
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
                            rules={rules}
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
  rules,
}: {
  request: CatalogRequest;
  categories: ReviewCategory[];
  /** Unused here: the reviewer types the code either way. Kept for the caller. */
  canOverrideCode: boolean;
  rules: CatalogRules;
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
  const categoryCodeProblem = categoryCodeError(categoryCode, rules.categoryCodeLength);
  const [name, setName] = useState(request.name);
  const [categoryId, setCategoryId] = useState(request.category?.id ?? "");
  // Pre-filled with what the asker suggested, so a reviewer who agrees does not
  // have to re-enter it.
  const [subcategoryId, setSubcategoryId] = useState(request.subcategory?.id ?? "");
  const [description, setDescription] = useState(request.description ?? "");
  const [reason, setReason] = useState("");

  const isProduct = request.type === "PRODUCT";
  const category = categories.find((c) => c.id === categoryId);
  const subcategories = category?.subcategories ?? [];
  const subcategory = subcategories.find((sub) => sub.id === subcategoryId);
  // The leading parts belong to the category and its subcategory and are never
  // typed — the reviewer supplies only what comes after them.
  const leader = codeLeaderOf(category, subcategory);
  const subcategoryRequired = rules.requireSubcategory && subcategories.length > 0;

  async function handleApprove(e: React.FormEvent) {
    e.preventDefault();
    setApproving(true);
    try {
      const result = await approveProductRequest(request.id, {
        code: isProduct ? code.trim() : undefined,
        name: name.trim(),
        categoryId: isProduct ? categoryId : undefined,
        subcategoryId: isProduct ? subcategoryId || undefined : undefined,
        description: isProduct ? description.trim() || undefined : undefined,
        codePrefix: isProduct ? undefined : categoryCode.trim().toUpperCase(),
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
        <DialogContent className="sm:max-w-xl">
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
                    onValueChange={(v) => {
                      setCategoryId((v as string) ?? "");
                      setSubcategoryId("");
                    }}
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

                {subcategories.length > 0 && (
                  <div className="space-y-2">
                    <Label>Subcategory {subcategoryRequired ? "*" : ""}</Label>
                    <Select
                      value={subcategoryId}
                      items={[
                        ...(subcategoryRequired ? [] : [{ value: "", label: "None" }]),
                        ...subcategories.map((sub) => ({
                          value: sub.id,
                          label: sub.code ? `${sub.name} (${sub.code})` : sub.name,
                        })),
                      ]}
                      onValueChange={(v) => setSubcategoryId((v as string) ?? "")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select subcategory" />
                      </SelectTrigger>
                      <SelectContent>
                        {!subcategoryRequired && <SelectItem value="">None</SelectItem>}
                        {subcategories.map((sub) => (
                          <SelectItem key={sub.id} value={sub.id}>
                            {sub.name}
                            {sub.code ? ` (${sub.code})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {request.subcategory && (
                      <p className="text-xs text-muted-foreground">
                        {request.requestedBy.name} suggested {request.subcategory.name}.
                      </p>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor={`code-${request.id}`}>
                    Product code
                    <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <div className="flex items-stretch rounded-md border focus-within:ring-2 focus-within:ring-ring">
                    <span className="flex select-none items-center rounded-l-md border-r bg-muted px-3 font-mono text-sm font-semibold text-muted-foreground">
                      {leader ?? "—"}
                    </span>
                    <Input
                      id={`code-${request.id}`}
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      placeholder={categoryId ? "001 — left blank, numbered automatically" : "Pick a category first"}
                      className="rounded-l-none border-0 font-mono shadow-none focus-visible:ring-0"
                      disabled={!categoryId}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {!categoryId
                      ? "Choose a category and its code prefix fills in here."
                      : code.trim()
                        ? `The code will be ${leader ?? ""}${code.trim()}`
                        : "Leave it blank and it takes the next number in this subcategory — 001, then 002."}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`desc-${request.id}`}>
                    Description {rules.requireDescription ? "*" : ""}
                  </Label>
                  <Textarea
                    id={`desc-${request.id}`}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. BLDC Control board"
                    rows={2}
                    maxLength={300}
                    required={rules.requireDescription}
                  />
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
                  onChange={(e) => setCategoryCode(e.target.value.toUpperCase())}
                  placeholder="e.g. 1001 or ELEC"
                  maxLength={rules.categoryCodeLength}
                  className="font-mono"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Letters, numbers or both, up to {rules.categoryCodeLength} character
                  {rules.categoryCodeLength === 1 ? "" : "s"}, unused by any other
                  category. Every product code in it will start with this.
                </p>
                {categoryCode.trim() && categoryCodeProblem && (
                  <p className="text-xs text-destructive">{categoryCodeProblem}</p>
                )}
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
                    ? !categoryId
                    : !!categoryCodeProblem)
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
        <DialogContent className="sm:max-w-xl">
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
