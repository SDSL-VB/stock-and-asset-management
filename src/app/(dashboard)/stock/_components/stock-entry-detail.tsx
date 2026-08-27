"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { ApprovalActions } from "./approval-actions";
import { FileUpload } from "./file-upload";
import {
  ArrowLeft,
  Edit,
  Paperclip,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  Trash2,
  Download,
} from "lucide-react";
import Link from "next/link";
import { hasPermission } from "@/lib/rbac/check";
import { PERMISSIONS, resolveStockScope } from "@/lib/rbac/permissions";
import { deleteAttachment } from "@/lib/actions/stock";
import { MoveStockDialog } from "./move-stock-dialog";
import { RequestTransferDialog } from "./request-transfer-dialog";
import { DocumentViewerButton } from "./document-viewer";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

type Entry = {
  id: string;
  entryNumber: string;
  itemCode: string | null;
  itemName: string;
  supplierName: string;
  /** How these goods came to be here: bought, built, or sent from another site */
  source: "PURCHASED" | "BUILT" | "TRANSFERRED";
  batchNumber: string | null;
  /** Consignments this entry's goods left on, and builds that ate them */
  dispatchItems: Array<{ quantity: number }>;
  buildConsumptions: Array<{ quantity: number }>;
  sourceDispatchItem: {
    id: string;
    dispatch: {
      id: string;
      dispatchNumber: string;
      receivedAt: Date | null;
      originLocation: { name: string } | null;
    };
  } | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  invoiceNumber: string | null;
  location: { id: string; name: string; code: string } | null;
  clientName: string | null;
  clientLocation: string | null;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  customFields: unknown;
  createdAt: Date;
  updatedAt: Date;
  product: { id: string; code: string; name: string; category: { id: string; name: string } } | null;
  department: { id: string; name: string } | null;
  createdBy: { id: string; name: string; email: string };
  approvedBy: { id: string; name: string } | null;
  issues: Array<{
    id: string;
    issueNumber: string;
    quantity: number;
    notes: string | null;
    createdAt: Date;
    department: { id: string; name: string };
    issuedBy: { id: string; name: string };
  }>;
  transferRequests: Array<{
    id: string;
    requestNumber: string;
    quantity: number;
    notes: string | null;
    status: "PENDING" | "APPROVED" | "REJECTED";
    reviewNote: string | null;
    createdAt: Date;
    department: { id: string; name: string };
    requestedBy: { id: string; name: string };
    reviewedBy: { id: string; name: string } | null;
  }>;
  attachments: Array<{
    id: string;
    fileName: string;
    fileUrl: string;
    fileSize: number;
    mimeType: string;
    attachmentType: string;
    createdAt: Date;
    uploadedBy: { id: string; name: string };
  }>;
  approvals: Array<{
    id: string;
    stepOrder: number;
    stepLabel: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    approverUserId: string | null;
    comments: string | null;
    createdAt: Date;
    updatedAt: Date;
    approver: { id: string; name: string } | null;
  }>;
};

interface AttachmentTypeConfig {
  id: string;
  name: string;
  isRequired: boolean;
  allowedMimeTypes: unknown;
  maxSizeBytes: number;
}

interface Props {
  entry: Entry;
  userPermissions: string[];
  userId: string;
  userDepartmentId?: string;
  attachmentTypes: AttachmentTypeConfig[];
  departments: { id: string; name: string }[];
}

const statusConfig = {
  DRAFT: { label: "Draft", color: "bg-gray-100 text-gray-700 border-gray-200", icon: FileText },
  SUBMITTED: { label: "Pending Approval", color: "bg-amber-50 text-amber-700 border-amber-200", icon: Clock },
  APPROVED: { label: "Approved", color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle },
  REJECTED: { label: "Rejected", color: "bg-red-50 text-red-700 border-red-200", icon: XCircle },
};

const approvalStepStatusIcon = {
  PENDING: <Clock className="h-4 w-4 text-amber-500" />,
  APPROVED: <CheckCircle className="h-4 w-4 text-emerald-500" />,
  REJECTED: <XCircle className="h-4 w-4 text-red-500" />,
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(amount);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StockEntryDetail({ entry, userPermissions, userId, attachmentTypes, departments }: Props) {
  const router = useRouter();
  const status = statusConfig[entry.status];
  const StatusIcon = status.icon;

  // Seeing every site is what lets someone edit an entry they did not create.
  // Resolved from permissions; the role name is not consulted anywhere here.
  const hasFullScope = resolveStockScope({ role: "", permissions: userPermissions }) === "all";
  const canSeeValue = hasPermission(userPermissions, PERMISSIONS.STOCK_VALUE_VIEW);

  const issuedQuantity = entry.issues.reduce((sum, i) => sum + i.quantity, 0);
  const pendingRequestedQuantity = entry.transferRequests
    .filter((r) => r.status === "PENDING")
    .reduce((sum, r) => sum + r.quantity, 0);
  const dispatchedQuantity = entry.dispatchItems.reduce((sum, d) => sum + d.quantity, 0);
  const consumedQuantity = entry.buildConsumptions.reduce((sum, c) => sum + c.quantity, 0);

  // Everything that has a claim on this entry, in one number — see
  // `availableQuantity`. This used to subtract issues alone, so goods already
  // dispatched to another site could be offered for moving a second time.
  const remainingQuantity =
    entry.quantity - issuedQuantity - dispatchedQuantity - consumedQuantity;

  // `availableQuantity` already nets off pending requests, so the two must not
  // both subtract them.
  const availableToRequest = remainingQuantity - pendingRequestedQuantity;

  // stock.move holders move stock directly; transfer requesters raise a
  // request that the receiving department's approver reviews
  const canMoveStock =
    entry.status === "APPROVED" &&
    remainingQuantity > 0 &&
    hasPermission(userPermissions, PERMISSIONS.STOCK_MOVE);

  const canRequestTransfer =
    entry.status === "APPROVED" &&
    availableToRequest > 0 &&
    !canMoveStock &&
    hasPermission(userPermissions, PERMISSIONS.ASSETS_TRANSFER_REQUEST);

  const canEdit =
    (entry.status === "DRAFT" || entry.status === "REJECTED") &&
    (entry.createdBy.id === userId || hasFullScope);

  const canApprove =
    hasPermission(userPermissions, PERMISSIONS.STOCK_APPROVE) &&
    entry.status === "SUBMITTED";

  // Transferred stock names its consignment for everyone; only someone who may
  // open the dispatch page gets a link to it, so nobody is offered a dead end.
  const canSeeDispatch = hasPermission(userPermissions, PERMISSIONS.DISPATCH_VIEW);

  const canUpload =
    (entry.status === "DRAFT" || entry.status === "REJECTED") &&
    (entry.createdBy.id === userId || hasFullScope);

  async function handleDeleteAttachment(attachmentId: string) {
    const result = await deleteAttachment(attachmentId);
    if ("error" in result) {
      toast.error(result.error);
    } else {
      toast.success("Attachment deleted");
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={entry.entryNumber}
        description={`${entry.itemName} from ${entry.supplierName}`}
      >
        <div className="flex items-center gap-2">
          <Link href="/stock">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          {canEdit && (
            <Link href={`/stock/${entry.id}/edit`}>
              <Button size="sm">
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Button>
            </Link>
          )}
        </div>
      </PageHeader>

      {/* Status and Rejection Reason */}
      <div className="flex items-center gap-3">
        <Badge variant="outline" className={`${status.color} text-sm px-3 py-1`}>
          <StatusIcon className="mr-1 h-3.5 w-3.5" />
          {status.label}
        </Badge>
      </div>

      {entry.status === "REJECTED" && entry.rejectionReason && (
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <XCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-red-800">Rejection Reason</p>
                <p className="text-sm text-red-700 mt-1">{entry.rejectionReason}</p>
                {canEdit && (
                  <Link href={`/stock/${entry.id}/edit`}>
                    <Button size="sm" className="mt-3">
                      <Edit className="mr-2 h-4 w-4" />
                      Edit &amp; Resubmit
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Details */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Entry Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-muted-foreground">Item Name</dt>
                  <dd className="font-medium">{entry.itemName}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Item Code</dt>
                  <dd className="font-mono font-semibold">{entry.itemCode ?? "—"}</dd>
                </div>
                {entry.product && (
                  <div>
                    <dt className="text-sm text-muted-foreground">Category</dt>
                    <dd className="font-medium">{entry.product.category.name}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-sm text-muted-foreground">Supplier</dt>
                  <dd className="font-medium">{entry.supplierName}</dd>
                </div>
                {/* Where these goods came from. Only worth saying when the
                    answer is not "we bought them" — a purchased entry already
                    says that with its supplier and invoice. */}
                {entry.source !== "PURCHASED" && (
                  <div>
                    <dt className="text-sm text-muted-foreground">How it got here</dt>
                    <dd className="font-medium">
                      {entry.source === "BUILT" ? (
                        "Built in-house"
                      ) : entry.sourceDispatchItem ? (
                        <>
                          Transferred from{" "}
                          {entry.sourceDispatchItem.dispatch.originLocation?.name ??
                            "another site"}{" "}
                          {canSeeDispatch ? (
                            <Link
                              href={`/dispatch?number=${entry.sourceDispatchItem.dispatch.dispatchNumber}`}
                              className="text-brand-blue hover:underline"
                            >
                              on {entry.sourceDispatchItem.dispatch.dispatchNumber}
                            </Link>
                          ) : (
                            <>on {entry.sourceDispatchItem.dispatch.dispatchNumber}</>
                          )}
                        </>
                      ) : (
                        "Transferred from another site"
                      )}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-sm text-muted-foreground">Quantity</dt>
                  <dd className="font-medium">{entry.quantity}</dd>
                </div>
                {canSeeValue && (
                  <>
                    <div>
                      <dt className="text-sm text-muted-foreground">Unit Price</dt>
                      <dd className="font-medium">{formatCurrency(entry.unitPrice)}</dd>
                    </div>
                    <div>
                      <dt className="text-sm text-muted-foreground">Total Price</dt>
                      <dd className="text-lg font-bold text-brand-green">
                        {formatCurrency(entry.totalPrice)}
                      </dd>
                    </div>
                  </>
                )}
                <div>
                  <dt className="text-sm text-muted-foreground">Stock Location</dt>
                  <dd className="font-medium">
                    {entry.location?.name ?? "Unassigned"}
                    {entry.clientName && (
                      <span className="block text-sm text-muted-foreground">
                        {entry.clientName}
                        {entry.clientLocation ? ` — ${entry.clientLocation}` : ""}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Department</dt>
                  <dd className="font-medium">
                    {entry.issues.length > 0
                      ? entry.issues.map((i) => i.department.name).filter((v, idx, a) => a.indexOf(v) === idx).join(", ")
                      : entry.department?.name ??
                        `Central Stock (${entry.location?.name ?? "Unassigned"})`}
                  </dd>
                </div>
                {entry.invoiceNumber && (
                  <div>
                    <dt className="text-sm text-muted-foreground">Invoice Number</dt>
                    <dd className="font-medium">{entry.invoiceNumber}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-sm text-muted-foreground">Created By</dt>
                  <dd className="font-medium">{entry.createdBy.name}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Created</dt>
                  <dd className="font-medium">
                    {new Date(entry.createdAt).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </dd>
                </div>
              </dl>

              {/* Custom fields */}
              {entry.customFields != null &&
                typeof entry.customFields === "object" &&
                Object.keys(entry.customFields as Record<string, unknown>).length > 0 ? (
                  <>
                    <hr className="my-4" />
                    <h4 className="text-sm font-semibold mb-3">Additional Information</h4>
                    <dl className="grid gap-4 sm:grid-cols-2">
                      {Object.entries(entry.customFields as Record<string, unknown>).map(
                        ([key, value]) => (
                          <div key={key}>
                            <dt className="text-sm text-muted-foreground capitalize">
                              {key.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}
                            </dt>
                            <dd className="font-medium">{String(value)}</dd>
                          </div>
                        )
                      )}
                    </dl>
                  </>
                ) : null}
            </CardContent>
          </Card>

          {/* Stock movements: central stock → departments */}
          {(entry.status === "APPROVED" ||
            entry.issues.length > 0 ||
            entry.transferRequests.length > 0) && (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>Stock Movements</CardTitle>
                  {canMoveStock && (
                    <MoveStockDialog
                      entryId={entry.id}
                      itemName={entry.itemName}
                      remainingQuantity={remainingQuantity}
                      departments={departments}
                    />
                  )}
                  {canRequestTransfer && (
                    <RequestTransferDialog
                      entryId={entry.id}
                      itemName={entry.itemName}
                      availableQuantity={availableToRequest}
                      departments={departments}
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Received</p>
                    <p className="text-lg font-bold">{entry.quantity}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Moved to Departments</p>
                    <p className="text-lg font-bold">{issuedQuantity}</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Remaining in Stock</p>
                    <p className="text-lg font-bold text-brand-green">{remainingQuantity}</p>
                  </div>
                </div>

                {entry.issues.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No movements yet — the full quantity is in central stock.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {entry.issues.map((issue) => (
                      <div
                        key={issue.id}
                        className="flex items-center justify-between rounded-lg border p-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {issue.quantity} unit{issue.quantity === 1 ? "" : "s"} →{" "}
                            {issue.department.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {issue.issueNumber} &middot; by {issue.issuedBy.name} &middot;{" "}
                            {new Date(issue.createdAt).toLocaleDateString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </p>
                          {issue.notes && (
                            <p className="text-xs italic text-muted-foreground mt-1">{issue.notes}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Transfer requests awaiting or processed */}
                {entry.transferRequests.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">Transfer Requests</h4>
                    {entry.transferRequests.map((req) => (
                      <div
                        key={req.id}
                        className="flex items-start justify-between gap-3 rounded-lg border p-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {req.quantity} unit{req.quantity === 1 ? "" : "s"} →{" "}
                            {req.department.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {req.requestNumber} &middot; requested by {req.requestedBy.name}{" "}
                            &middot;{" "}
                            {new Date(req.createdAt).toLocaleDateString("en-IN", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </p>
                          {req.status === "REJECTED" && req.reviewNote && (
                            <p className="text-xs text-red-600 mt-1">
                              Rejected: {req.reviewNote}
                            </p>
                          )}
                        </div>
                        <Badge
                          variant="outline"
                          className={
                            req.status === "PENDING"
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : req.status === "APPROVED"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-red-50 text-red-700 border-red-200"
                          }
                        >
                          {req.status === "PENDING"
                            ? "Awaiting Manager"
                            : req.status === "APPROVED"
                              ? "Approved"
                              : "Rejected"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Attachments */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Paperclip className="h-5 w-5" />
                Attachments ({entry.attachments.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {entry.attachments.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No attachments uploaded
                </p>
              ) : (
                <div className="space-y-2">
                  {entry.attachments.map((att) => (
                    <div
                      key={att.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="h-8 w-8 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{att.fileName}</p>
                          <p className="text-xs text-muted-foreground">
                            {att.attachmentType} &middot; {formatFileSize(att.fileSize)} &middot;{" "}
                            {att.uploadedBy.name}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <DocumentViewerButton attachment={att} />
                        <a href={att.fileUrl} download={att.fileName} title="Download">
                          <Button variant="ghost" size="sm">
                            <Download className="h-4 w-4" />
                          </Button>
                        </a>
                        {canUpload && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteAttachment(att.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Required attachment warnings */}
              {canUpload && attachmentTypes.filter((at) => at.isRequired).length > 0 && (
                <div className="mt-3 space-y-1">
                  {attachmentTypes
                    .filter((at) => at.isRequired)
                    .map((at) => {
                      const hasIt = entry.attachments.some(
                        (a) => a.attachmentType === at.name
                      );
                      return (
                        <div
                          key={at.id}
                          className={`flex items-center gap-2 text-xs ${
                            hasIt ? "text-emerald-600" : "text-amber-600"
                          }`}
                        >
                          {hasIt ? (
                            <CheckCircle className="h-3.5 w-3.5" />
                          ) : (
                            <Clock className="h-3.5 w-3.5" />
                          )}
                          <span>
                            {at.name} {at.isRequired ? "(required)" : ""} —{" "}
                            {hasIt ? "Uploaded" : "Missing"}
                          </span>
                        </div>
                      );
                    })}
                </div>
              )}

              {canUpload && (
                <div className="mt-4">
                  <FileUpload
                    stockEntryId={entry.id}
                    attachmentTypes={attachmentTypes}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar: Approval Timeline */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Approval Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {entry.approvals.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {entry.status === "DRAFT"
                    ? "Submit the entry to start the approval process"
                    : "No approval steps configured"}
                </p>
              ) : (
                <div className="space-y-4">
                  {entry.approvals.map((approval, idx) => (
                    <div key={approval.id} className="relative">
                      {idx < entry.approvals.length - 1 && (
                        <div className="absolute left-[11px] top-8 h-full w-0.5 bg-border" />
                      )}
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 shrink-0">
                          {approvalStepStatusIcon[approval.status]}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{approval.stepLabel}</p>
                          <p className="text-xs text-muted-foreground">
                            Step {approval.stepOrder}
                          </p>
                          {approval.approver && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {approval.status === "APPROVED" ? "Approved" : "Rejected"} by{" "}
                              <span className="font-medium">{approval.approver.name}</span>
                            </p>
                          )}
                          {approval.comments && (
                            <p className="text-xs mt-1 italic">{approval.comments}</p>
                          )}
                          {approval.status !== "PENDING" && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Date(approval.updatedAt).toLocaleDateString("en-IN", {
                                day: "2-digit",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Approval Actions */}
          {canApprove && (
            <ApprovalActions
              entryId={entry.id}
              approvals={entry.approvals}
            />
          )}
        </div>
      </div>
    </div>
  );
}
