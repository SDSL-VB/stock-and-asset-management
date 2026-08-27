"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  HelpCircle,
  FileText,
  Paperclip,
  GitBranch,
  ArrowRight,
  CheckCircle,
  Clock,
  Plus,
  Settings2,
  Edit,
  Trash2,
  ToggleLeft,
} from "lucide-react";

export function HowToGuide() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <HelpCircle className="mr-2 h-4 w-4" />
        How To
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Stock Configuration Guide</DialogTitle>
            <DialogDescription>
              Step-by-step instructions for configuring the stock entry system
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="fields" className="mt-2">
            <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
              <TabsTrigger value="fields" className="text-xs">
                <Settings2 className="mr-1 h-3.5 w-3.5" />
                Fields
              </TabsTrigger>
              <TabsTrigger value="attachments" className="text-xs">
                <Paperclip className="mr-1 h-3.5 w-3.5" />
                Attachments
              </TabsTrigger>
              <TabsTrigger value="workflows" className="text-xs">
                <GitBranch className="mr-1 h-3.5 w-3.5" />
                Workflows
              </TabsTrigger>
              <TabsTrigger value="overview" className="text-xs">
                <HelpCircle className="mr-1 h-3.5 w-3.5" />
                Overview
              </TabsTrigger>
            </TabsList>

            {/* Custom Fields Tab */}
            <TabsContent value="fields" className="space-y-4 mt-4">
              <div className="space-y-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-green/10">
                    <FileText className="h-4 w-4 text-brand-green" />
                  </div>
                  Custom Fields
                </h3>
                <p className="text-sm text-muted-foreground">
                  Add extra data fields to the stock entry form. These appear alongside the default fields (item name, supplier, quantity, etc.) when operators create or edit stock entries.
                </p>
              </div>

              {/* Step by step */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium">How to add a custom field:</h4>
                <div className="space-y-2">
                  <Step number={1} icon={Plus}>
                    Click the <strong>&quot;Add Field&quot;</strong> button at the top-right of the Custom Fields tab.
                  </Step>
                  <Step number={2} icon={Edit}>
                    Fill in the field details:
                    <ul className="list-disc pl-5 mt-1 space-y-0.5 text-muted-foreground">
                      <li><strong>Field Label</strong> &mdash; What users see (e.g. &quot;Batch Number&quot;)</li>
                      <li><strong>Field Name</strong> &mdash; Internal code name, no spaces (e.g. &quot;batchNumber&quot;). Cannot be changed after creation.</li>
                      <li><strong>Type</strong> &mdash; Choose from: Text, Number, Date, Select (dropdown), or Textarea</li>
                      <li><strong>Display Order</strong> &mdash; Lower numbers appear first on the form</li>
                      <li><strong>Required</strong> &mdash; Toggle ON if this field must be filled before submission</li>
                    </ul>
                  </Step>
                  <Step number={3} icon={CheckCircle}>
                    Click <strong>&quot;Create&quot;</strong>. The field will immediately appear in the stock entry form.
                  </Step>
                </div>
              </div>

              {/* Visual example */}
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <h4 className="text-sm font-medium">Example: Adding a &quot;Purchase Order Number&quot; field</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="rounded border bg-background p-3 space-y-1">
                    <p className="text-xs text-muted-foreground">Field Label</p>
                    <p className="font-medium">Purchase Order Number</p>
                  </div>
                  <div className="rounded border bg-background p-3 space-y-1">
                    <p className="text-xs text-muted-foreground">Field Name</p>
                    <p className="font-mono text-xs">purchaseOrderNumber</p>
                  </div>
                  <div className="rounded border bg-background p-3 space-y-1">
                    <p className="text-xs text-muted-foreground">Type</p>
                    <Badge variant="secondary">TEXT</Badge>
                  </div>
                  <div className="rounded border bg-background p-3 space-y-1">
                    <p className="text-xs text-muted-foreground">Required</p>
                    <p className="font-medium">Yes</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Result: A &quot;Purchase Order Number&quot; text input will appear on every new stock entry form, and operators must fill it in before submitting.
                </p>
              </div>

              {/* Actions reference */}
              <div className="rounded-lg border p-4 space-y-2">
                <h4 className="text-sm font-medium">Available actions per field:</h4>
                <div className="grid gap-2">
                  <ActionItem icon={Edit} label="Edit" description="Modify the field label, type, required status, or display order. Field name cannot be changed." />
                  <ActionItem icon={ToggleLeft} label="Toggle" description="Enable or disable the field. Disabled fields won't appear in new entries but existing data is kept." />
                  <ActionItem icon={Trash2} label="Delete" description="Permanently remove the field. Existing entries retain their data, but the field won't appear in new entries." />
                </div>
              </div>

              {/* SELECT type special */}
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 space-y-2">
                <h4 className="text-sm font-medium text-amber-800">Special: SELECT (Dropdown) Type</h4>
                <p className="text-sm text-amber-700">
                  When you choose the <strong>SELECT</strong> type, an extra &quot;Options&quot; field appears. Enter your dropdown choices separated by commas.
                </p>
                <div className="rounded border bg-background p-3 text-sm">
                  <p className="text-xs text-muted-foreground">Example options:</p>
                  <p className="font-mono text-xs mt-1">Local Vendor, Import, Direct Purchase, Government Tender</p>
                </div>
              </div>
            </TabsContent>

            {/* Attachment Types Tab */}
            <TabsContent value="attachments" className="space-y-4 mt-4">
              <div className="space-y-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-blue/10">
                    <Paperclip className="h-4 w-4 text-brand-blue" />
                  </div>
                  Attachment Types
                </h3>
                <p className="text-sm text-muted-foreground">
                  Define what types of documents can be uploaded with stock entries. Each type has its own size limit and file format restrictions.
                </p>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-medium">How to add an attachment type:</h4>
                <div className="space-y-2">
                  <Step number={1} icon={Plus}>
                    Click <strong>&quot;Add Type&quot;</strong> in the Attachment Types tab.
                  </Step>
                  <Step number={2} icon={Edit}>
                    Configure the attachment type:
                    <ul className="list-disc pl-5 mt-1 space-y-0.5 text-muted-foreground">
                      <li><strong>Name</strong> &mdash; Category name (e.g. &quot;Invoice&quot;, &quot;Delivery Note&quot;)</li>
                      <li><strong>Max File Size</strong> &mdash; Maximum size in MB (default: 5MB)</li>
                      <li><strong>Allowed MIME Types</strong> &mdash; File formats accepted (e.g. &quot;application/pdf, image/jpeg&quot;)</li>
                      <li><strong>Required</strong> &mdash; Toggle ON if this document must be uploaded before submission</li>
                    </ul>
                  </Step>
                  <Step number={3} icon={CheckCircle}>
                    Click <strong>&quot;Create&quot;</strong>. This type will now appear as an option when uploading files on stock entries.
                  </Step>
                </div>
              </div>

              {/* Visual: How required attachments work */}
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <h4 className="text-sm font-medium">How required attachments work</h4>
                <p className="text-sm text-muted-foreground">
                  When a type is marked as &quot;Required&quot;, the stock entry detail page shows a checklist:
                </p>
                <div className="rounded border bg-background p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-emerald-600">
                    <CheckCircle className="h-3.5 w-3.5" />
                    <span>Invoice (required) &mdash; Uploaded</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-amber-600">
                    <Clock className="h-3.5 w-3.5" />
                    <span>Bill (required) &mdash; Missing</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-emerald-600">
                    <CheckCircle className="h-3.5 w-3.5" />
                    <span>Delivery Note (required) &mdash; Uploaded</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Operators can see which required documents are still missing before they submit the entry for approval.
                </p>
              </div>

              {/* Common MIME types reference */}
              <div className="rounded-lg border p-4 space-y-2">
                <h4 className="text-sm font-medium">Common MIME types reference:</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono text-[10px]">application/pdf</Badge>
                    <span className="text-muted-foreground">PDF files</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono text-[10px]">image/jpeg</Badge>
                    <span className="text-muted-foreground">JPEG images</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono text-[10px]">image/png</Badge>
                    <span className="text-muted-foreground">PNG images</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono text-[10px]">image/*</Badge>
                    <span className="text-muted-foreground">Any image</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Leave the &quot;Allowed MIME Types&quot; field empty to accept all file formats.
                </p>
              </div>
            </TabsContent>

            {/* Approval Workflows Tab */}
            <TabsContent value="workflows" className="space-y-4 mt-4">
              <div className="space-y-2">
                <h3 className="font-semibold flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50">
                    <GitBranch className="h-4 w-4 text-amber-600" />
                  </div>
                  Approval Workflows
                </h3>
                <p className="text-sm text-muted-foreground">
                  Control who approves stock entries and in what order. Each department can have its own workflow, or use a shared default flow.
                </p>
              </div>

              {/* Visual flow diagram */}
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <h4 className="text-sm font-medium">Visual: How the approval flow works</h4>
                <div className="flex items-center justify-center gap-2 flex-wrap py-2">
                  <FlowStep label="Operator creates entry" status="draft" />
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  <FlowStep label="Entry submitted" status="submitted" />
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  <FlowStep label="Step 1: Manager Review" status="pending" />
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  <FlowStep label="Step 2: Director Sign-off" status="pending" />
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  <FlowStep label="Approved" status="approved" />
                </div>
                <div className="flex items-center justify-center gap-2 text-xs text-red-600 mt-1">
                  <span>If any step rejects</span>
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-medium">Entry sent back to operator with reason</span>
                  <ArrowRight className="h-3 w-3" />
                  <span>Operator can edit &amp; resubmit</span>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-medium">How to set up a workflow:</h4>
                <div className="space-y-2">
                  <Step number={1} icon={Plus}>
                    Click <strong>&quot;Add Flow&quot;</strong> to create a new approval workflow.
                  </Step>
                  <Step number={2} icon={Edit}>
                    Enter a flow name (e.g. &quot;Engineering Approval Flow&quot;) and optionally assign it to a department. If no department is selected, it becomes the default flow for all departments without a specific one.
                  </Step>
                  <Step number={3} icon={Plus}>
                    Click <strong>&quot;Add Step&quot;</strong> within the flow to add approval steps:
                    <ul className="list-disc pl-5 mt-1 space-y-0.5 text-muted-foreground">
                      <li><strong>Step Label</strong> &mdash; A descriptive name (e.g. &quot;Manager Review&quot;)</li>
                      <li><strong>Step Order</strong> &mdash; The sequence number (1 = first, 2 = second, etc.)</li>
                      <li><strong>Approver Role</strong> &mdash; Which role can approve at this step</li>
                    </ul>
                  </Step>
                  <Step number={4} icon={CheckCircle}>
                    The workflow is ready. When an operator submits a stock entry from this department, the approval steps will be applied in order.
                  </Step>
                </div>
              </div>

              {/* Example workflow */}
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <h4 className="text-sm font-medium">Example: Two-step approval for Engineering</h4>
                <div className="space-y-2">
                  <div className="rounded border bg-background p-3">
                    <p className="text-xs text-muted-foreground">Flow Name</p>
                    <p className="text-sm font-medium">Engineering Approval Flow</p>
                    <p className="text-xs text-muted-foreground mt-1">Department: Engineering</p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-3 rounded border bg-background p-2.5">
                      <Badge variant="secondary" className="text-xs shrink-0">Step 1</Badge>
                      <div>
                        <p className="text-sm font-medium">Department Manager Review</p>
                        <p className="text-xs text-muted-foreground">Approver: Department Manager</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 rounded border bg-background p-2.5">
                      <Badge variant="secondary" className="text-xs shrink-0">Step 2</Badge>
                      <div>
                        <p className="text-sm font-medium">Director Final Approval</p>
                        <p className="text-xs text-muted-foreground">Approver: Super Admin</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Key rules */}
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 space-y-2">
                <h4 className="text-sm font-medium text-amber-800">Key rules</h4>
                <ul className="list-disc pl-4 space-y-1 text-sm text-amber-700">
                  <li>Each department can have <strong>at most one</strong> approval flow. The system falls back to the default (global) flow if no department-specific flow exists.</li>
                  <li>Steps are processed <strong>in order</strong>. Step 2 cannot be approved until Step 1 is complete.</li>
                  <li>Approvals are <strong>snapshot-based</strong>: when an entry is submitted, the current flow steps are copied into the entry. Changing the flow later won&apos;t affect entries already submitted.</li>
                  <li>A rejection at <strong>any step</strong> immediately rejects the entire entry.</li>
                </ul>
              </div>
            </TabsContent>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-4 mt-4">
              <div className="space-y-2">
                <h3 className="font-semibold">System Overview</h3>
                <p className="text-sm text-muted-foreground">
                  Understanding how all the pieces fit together.
                </p>
              </div>

              {/* End-to-end flow */}
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <h4 className="text-sm font-medium">Complete stock entry lifecycle:</h4>
                <div className="space-y-2">
                  <LifecycleStep
                    number={1}
                    title="Configure (Admin)"
                    description="Admin sets up custom fields, attachment types, and approval workflows on this page."
                  />
                  <LifecycleStep
                    number={2}
                    title="Create Entry (Operator)"
                    description="Stock Entry Operator fills in item details, custom fields, and saves as Draft."
                  />
                  <LifecycleStep
                    number={3}
                    title="Upload Documents (Operator)"
                    description="Operator uploads required attachments (invoices, bills, delivery notes)."
                  />
                  <LifecycleStep
                    number={4}
                    title="Submit for Approval (Operator)"
                    description="Operator clicks Submit. The system creates approval records based on the configured workflow."
                  />
                  <LifecycleStep
                    number={5}
                    title="Review & Approve (Manager)"
                    description="Department Manager reviews the entry and either approves or rejects with a reason."
                  />
                  <LifecycleStep
                    number={6}
                    title="Final Status"
                    description="If approved, the entry is finalized. If rejected, the operator can edit and resubmit."
                  />
                </div>
              </div>

              {/* Role permissions */}
              <div className="rounded-lg border p-4 space-y-3">
                <h4 className="text-sm font-medium">Who can do what:</h4>
                <div className="space-y-2">
                  <RoleRow
                    role="Stock Entry Operator"
                    actions={["Create entries", "Upload attachments", "Submit for approval", "Edit rejected entries"]}
                  />
                  <RoleRow
                    role="Department Manager"
                    actions={["View department entries", "Approve/reject entries", "View department reports"]}
                  />
                  <RoleRow
                    role="Admin"
                    actions={["Configure fields, attachments, workflows", "View all entries", "View all reports", "Export reports"]}
                  />
                  <RoleRow
                    role="Super Admin"
                    actions={["Everything above", "Manage users, roles & permissions", "View activity logs"]}
                  />
                </div>
              </div>

              {/* Tips */}
              <div className="rounded-lg border p-4 space-y-2">
                <h4 className="text-sm font-medium">Tips &amp; best practices:</h4>
                <ul className="list-disc pl-4 space-y-1.5 text-sm text-muted-foreground">
                  <li>Changes to custom fields and attachment types only affect <strong>new entries</strong>. Existing entries retain their original data.</li>
                  <li>Changing an approval workflow does <strong>not</strong> affect entries already submitted. They keep the workflow that was active at submission time.</li>
                  <li>Always create a <strong>default (global) flow</strong> as a fallback for departments without their own workflow.</li>
                  <li>Use <strong>display order</strong> numbers with gaps (10, 20, 30) so you can insert new fields in between without renumbering everything.</li>
                  <li>Mark critical documents (like invoices) as <strong>required</strong> to ensure they are uploaded before submission.</li>
                  <li>Use <strong>SELECT</strong> field type for standardized values (e.g. procurement method) to keep data consistent across entries.</li>
                </ul>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ========== Helper Components ==========

function Step({ number, children }: { number: number; icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-navy text-white text-xs font-bold shrink-0 mt-0.5">
        {number}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function ActionItem({ icon: Icon, label, description }: { icon: React.ComponentType<{ className?: string }>; label: string; description: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div>
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm text-muted-foreground"> &mdash; {description}</span>
      </div>
    </div>
  );
}

function FlowStep({ label, status }: { label: string; status: "draft" | "submitted" | "pending" | "approved" }) {
  const colors = {
    draft: "bg-gray-100 text-gray-700 border-gray-200",
    submitted: "bg-amber-50 text-amber-700 border-amber-200",
    pending: "bg-blue-50 text-blue-700 border-blue-200",
    approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
  return (
    <div className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${colors[status]}`}>
      {label}
    </div>
  );
}

function LifecycleStep({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-brand-green text-brand-green text-xs font-bold shrink-0">
        {number}
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function RoleRow({ role, actions }: { role: string; actions: string[] }) {
  return (
    <div className="rounded-lg border p-3">
      <Badge variant="secondary" className="text-xs mb-1.5">{role}</Badge>
      <div className="flex flex-wrap gap-1.5 mt-1">
        {actions.map((action) => (
          <span key={action} className="text-xs text-muted-foreground flex items-center gap-1">
            <CheckCircle className="h-3 w-3 text-emerald-500" />
            {action}
          </span>
        ))}
      </div>
    </div>
  );
}
