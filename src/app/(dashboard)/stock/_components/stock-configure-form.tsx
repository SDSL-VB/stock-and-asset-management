"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Loader2,
  Trash2,
  Settings2,
  Paperclip,
  GitBranch,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  createFieldConfig,
  updateFieldConfig,
  toggleFieldConfig,
  deleteFieldConfig,
  deleteAttachmentTypeConfig,
  createAttachmentTypeConfig,
  updateAttachmentTypeConfig,
  toggleAttachmentTypeConfig,
  createApprovalFlow,
  updateApprovalFlow,
  addApprovalFlowStep,
  removeApprovalFlowStep,
} from "@/lib/actions/stock-config";

interface FieldConfig {
  id: string;
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  isRequired: boolean;
  isActive: boolean;
  options: unknown;
  displayOrder: number;
}

interface AttachmentType {
  id: string;
  name: string;
  isRequired: boolean;
  isActive: boolean;
  allowedMimeTypes: unknown;
  maxSizeBytes: number;
}

interface ApprovalFlow {
  id: string;
  name: string;
  departmentId: string | null;
  isActive: boolean;
  department: { id: string; name: string } | null;
  steps: Array<{
    id: string;
    stepOrder: number;
    stepLabel: string;
    approverRoleId: string;
    approverRole: { id: string; name: string };
  }>;
}

interface Props {
  fieldConfigs: FieldConfig[];
  attachmentTypes: AttachmentType[];
  approvalFlows: ApprovalFlow[];
  roles: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  /** Which configuration areas the user may manage (per-area permissions) */
  canConfigureFields?: boolean;
  canConfigureAttachments?: boolean;
  canConfigureFlows?: boolean;
}

export function StockConfigureForm({
  fieldConfigs,
  attachmentTypes,
  approvalFlows,
  roles,
  departments,
  canConfigureFields = true,
  canConfigureAttachments = true,
  canConfigureFlows = true,
}: Props) {
  const router = useRouter();

  const defaultTab = canConfigureFields
    ? "fields"
    : canConfigureAttachments
      ? "attachments"
      : "workflows";

  return (
    <Tabs defaultValue={defaultTab} className="space-y-4">
      <TabsList>
        {canConfigureFields && (
          <TabsTrigger value="fields" className="gap-2">
            <Settings2 className="h-4 w-4" />
            Custom Fields
          </TabsTrigger>
        )}
        {canConfigureAttachments && (
          <TabsTrigger value="attachments" className="gap-2">
            <Paperclip className="h-4 w-4" />
            Attachment Types
          </TabsTrigger>
        )}
        {canConfigureFlows && (
          <TabsTrigger value="workflows" className="gap-2">
            <GitBranch className="h-4 w-4" />
            Approval Workflows
          </TabsTrigger>
        )}
      </TabsList>

      {/* Custom Fields Tab */}
      {canConfigureFields && (
        <TabsContent value="fields">
          <FieldConfigSection configs={fieldConfigs} router={router} />
        </TabsContent>
      )}

      {/* Attachment Types Tab */}
      {canConfigureAttachments && (
        <TabsContent value="attachments">
          <AttachmentTypeSection configs={attachmentTypes} router={router} />
        </TabsContent>
      )}

      {/* Approval Workflows Tab */}
      {canConfigureFlows && (
        <TabsContent value="workflows">
          <ApprovalFlowSection
            flows={approvalFlows}
            roles={roles}
            departments={departments}
            router={router}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}

// =====================
// Custom Fields Section
// =====================
function FieldConfigSection({
  configs,
  router,
}: {
  configs: FieldConfig[];
  router: ReturnType<typeof useRouter>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FieldConfig | null>(null);
  const [form, setForm] = useState({
    fieldName: "",
    fieldLabel: "",
    fieldType: "TEXT",
    isRequired: false,
    displayOrder: 0,
    options: "",
  });

  function openNew() {
    setEditId(null);
    setForm({
      fieldName: "",
      fieldLabel: "",
      fieldType: "TEXT",
      isRequired: false,
      displayOrder: 0,
      options: "",
    });
    setDialogOpen(true);
  }

  function openEdit(config: FieldConfig) {
    setEditId(config.id);
    setForm({
      fieldName: config.fieldName,
      fieldLabel: config.fieldLabel,
      fieldType: config.fieldType,
      isRequired: config.isRequired,
      displayOrder: config.displayOrder,
      options: Array.isArray(config.options)
        ? (config.options as string[]).join(", ")
        : "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    setLoading(true);
    try {
      const data = {
        ...form,
        options:
          form.fieldType === "SELECT"
            ? form.options
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
      };

      const result = editId
        ? await updateFieldConfig(editId, data)
        : await createFieldConfig(data);

      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(editId ? "Field updated" : "Field created");
        setDialogOpen(false);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(id: string) {
    const result = await toggleFieldConfig(id);
    if ("error" in result) toast.error(result.error);
    else router.refresh();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const result = await deleteFieldConfig(deleteTarget.id);
    if ("error" in result) {
      toast.error(result.error);
    } else {
      toast.success(`Field "${deleteTarget.fieldLabel}" deleted`);
      setDeleteTarget(null);
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Custom Fields</CardTitle>
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" /> Add Field
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Required</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {configs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-8"
                >
                  No custom fields configured
                </TableCell>
              </TableRow>
            ) : (
              configs.map((config) => (
                <TableRow key={config.id}>
                  <TableCell className="font-medium">
                    {config.fieldLabel}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {config.fieldName}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{config.fieldType}</Badge>
                  </TableCell>
                  <TableCell>{config.isRequired ? "Yes" : "No"}</TableCell>
                  <TableCell>{config.displayOrder}</TableCell>
                  <TableCell>
                    <Switch
                      checked={config.isActive}
                      onCheckedChange={() => handleToggle(config.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(config)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="lg"
                        onClick={() => setDeleteTarget(config)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editId ? "Edit Field" : "Add Custom Field"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Field Label</Label>
                <Input
                  value={form.fieldLabel}
                  onChange={(e) =>
                    setForm({ ...form, fieldLabel: e.target.value })
                  }
                  placeholder="e.g. Purchase Order Number"
                />
              </div>
              <div className="space-y-2">
                <Label>Field Name (code)</Label>
                <Input
                  value={form.fieldName}
                  onChange={(e) =>
                    setForm({ ...form, fieldName: e.target.value })
                  }
                  placeholder="e.g. purchase_order_number"
                  disabled={!!editId}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={form.fieldType}
                  items={[
                    { value: "TEXT", label: "Text" },
                    { value: "NUMBER", label: "Number" },
                    { value: "DATE", label: "Date" },
                    { value: "SELECT", label: "Select (dropdown)" },
                    { value: "TEXTAREA", label: "Textarea" },
                  ]}
                  onValueChange={(v) =>
                    setForm({ ...form, fieldType: v ?? "TEXT" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TEXT">Text</SelectItem>
                    <SelectItem value="NUMBER">Number</SelectItem>
                    <SelectItem value="DATE">Date</SelectItem>
                    <SelectItem value="SELECT">Select (dropdown)</SelectItem>
                    <SelectItem value="TEXTAREA">Textarea</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Display Order</Label>
                <Input
                  type="number"
                  value={form.displayOrder}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      displayOrder: parseInt(e.target.value) || 0,
                    })
                  }
                />
              </div>
            </div>
            {form.fieldType === "SELECT" && (
              <div className="space-y-2">
                <Label>Options (comma-separated)</Label>
                <Input
                  value={form.options}
                  onChange={(e) =>
                    setForm({ ...form, options: e.target.value })
                  }
                  placeholder="Option A, Option B, Option C"
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch
                checked={form.isRequired}
                onCheckedChange={(v) => setForm({ ...form, isRequired: v })}
              />
              <Label>Required field</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Custom Field"
        description={`Are you sure you want to delete the field "${deleteTarget?.fieldLabel}"? This action cannot be undone. Any existing stock entries with data in this field will retain their data, but the field will no longer appear in new entries.`}
        confirmLabel="Delete Field"
        onConfirm={handleDelete}
        destructive
      />
    </Card>
  );
}

// =====================
// Attachment Types Section
// =====================
function AttachmentTypeSection({
  configs,
  router,
}: {
  configs: AttachmentType[];
  router: ReturnType<typeof useRouter>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AttachmentType | null>(null);
  const [form, setForm] = useState({
    name: "",
    isRequired: false,
    maxSizeMB: 5,
    allowedTypes: "application/pdf, image/jpeg, image/png",
  });

  function openNew() {
    setEditId(null);
    setForm({
      name: "",
      isRequired: false,
      maxSizeMB: 5,
      allowedTypes: "application/pdf, image/jpeg, image/png",
    });
    setDialogOpen(true);
  }

  function openEdit(config: AttachmentType) {
    setEditId(config.id);
    setForm({
      name: config.name,
      isRequired: config.isRequired,
      maxSizeMB: Math.round(config.maxSizeBytes / 1024 / 1024),
      allowedTypes: Array.isArray(config.allowedMimeTypes)
        ? (config.allowedMimeTypes as string[]).join(", ")
        : "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    setLoading(true);
    try {
      const data = {
        name: form.name,
        isRequired: form.isRequired,
        maxSizeBytes: form.maxSizeMB * 1024 * 1024,
        allowedMimeTypes: form.allowedTypes
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };

      const result = editId
        ? await updateAttachmentTypeConfig(editId, data)
        : await createAttachmentTypeConfig(data);

      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(editId ? "Updated" : "Created");
        setDialogOpen(false);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(id: string) {
    const result = await toggleAttachmentTypeConfig(id);
    if ("error" in result) toast.error(result.error);
    else router.refresh();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const result = await deleteAttachmentTypeConfig(deleteTarget.id);
    if ("error" in result) {
      toast.error(result.error);
    } else {
      toast.success(`Attachment type "${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Attachment Types</CardTitle>
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" /> Add Type
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Required</TableHead>
              <TableHead>Max Size</TableHead>
              <TableHead>Allowed Types</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {configs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground py-8"
                >
                  No attachment types configured
                </TableCell>
              </TableRow>
            ) : (
              configs.map((config) => (
                <TableRow key={config.id}>
                  <TableCell className="font-medium">{config.name}</TableCell>
                  <TableCell>{config.isRequired ? "Yes" : "No"}</TableCell>
                  <TableCell>
                    {Math.round(config.maxSizeBytes / 1024 / 1024)}MB
                  </TableCell>
                  <TableCell className="text-xs">
                    {Array.isArray(config.allowedMimeTypes)
                      ? (config.allowedMimeTypes as string[]).join(", ")
                      : "Any"}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={config.isActive}
                      onCheckedChange={() => handleToggle(config.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(config)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(config)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editId ? "Edit Attachment Type" : "Add Attachment Type"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Purchase Order"
              />
            </div>
            <div className="space-y-2">
              <Label>Max File Size (MB)</Label>
              <Input
                type="number"
                value={form.maxSizeMB}
                onChange={(e) =>
                  setForm({ ...form, maxSizeMB: parseInt(e.target.value) || 5 })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Allowed MIME Types (comma-separated)</Label>
              <Input
                value={form.allowedTypes}
                onChange={(e) =>
                  setForm({ ...form, allowedTypes: e.target.value })
                }
                placeholder="application/pdf, image/jpeg"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.isRequired}
                onCheckedChange={(v) => setForm({ ...form, isRequired: v })}
              />
              <Label>Required attachment</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Attachment Type"
        description={`Are you sure you want to delete the attachment type "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete Type"
        onConfirm={handleDelete}
        destructive
      />
    </Card>
  );
}

// =====================
// Approval Flows Section
// =====================
function ApprovalFlowSection({
  flows,
  roles,
  departments,
  router,
}: {
  flows: ApprovalFlow[];
  roles: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  router: ReturnType<typeof useRouter>;
}) {
  const [flowDialogOpen, setFlowDialogOpen] = useState(false);
  const [stepDialogOpen, setStepDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editFlowId, setEditFlowId] = useState<string | null>(null);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [flowForm, setFlowForm] = useState({
    name: "",
    departmentId: "",
    isActive: true,
  });
  const [stepForm, setStepForm] = useState({
    stepOrder: 1,
    stepLabel: "",
    approverRoleId: "",
  });

  function openNewFlow() {
    setEditFlowId(null);
    setFlowForm({ name: "", departmentId: "", isActive: true });
    setFlowDialogOpen(true);
  }

  function openEditFlow(flow: ApprovalFlow) {
    setEditFlowId(flow.id);
    setFlowForm({
      name: flow.name,
      departmentId: flow.departmentId ?? "",
      isActive: flow.isActive,
    });
    setFlowDialogOpen(true);
  }

  function openAddStep(flowId: string, nextOrder: number) {
    setSelectedFlowId(flowId);
    setStepForm({ stepOrder: nextOrder, stepLabel: "", approverRoleId: "" });
    setStepDialogOpen(true);
  }

  async function handleSaveFlow() {
    setLoading(true);
    try {
      const data = {
        name: flowForm.name,
        departmentId: flowForm.departmentId || null,
        isActive: flowForm.isActive,
      };

      const result = editFlowId
        ? await updateApprovalFlow(editFlowId, data)
        : await createApprovalFlow(data);

      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(editFlowId ? "Flow updated" : "Flow created");
        setFlowDialogOpen(false);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleAddStep() {
    if (!selectedFlowId) return;
    setLoading(true);
    try {
      const result = await addApprovalFlowStep(selectedFlowId, stepForm);
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success("Step added");
        setStepDialogOpen(false);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveStep(stepId: string) {
    const result = await removeApprovalFlowStep(stepId);
    if ("error" in result) toast.error(result.error);
    else {
      toast.success("Step removed");
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={openNewFlow}>
          <Plus className="mr-2 h-4 w-4" /> Add Flow
        </Button>
      </div>

      {flows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No approval flows configured
          </CardContent>
        </Card>
      ) : (
        flows.map((flow) => (
          <Card key={flow.id}>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base">{flow.name}</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {flow.department
                    ? `Department: ${flow.department.name}`
                    : "Default (all departments)"}
                  {!flow.isActive && (
                    <Badge variant="secondary" className="ml-2">
                      Inactive
                    </Badge>
                  )}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openEditFlow(flow)}
              >
                Edit
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Step Label</TableHead>
                    <TableHead>Approver Role</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flow.steps.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="text-center text-muted-foreground py-4"
                      >
                        No steps — add at least one step
                      </TableCell>
                    </TableRow>
                  ) : (
                    flow.steps.map((step) => (
                      <TableRow key={step.id}>
                        <TableCell>{step.stepOrder}</TableCell>
                        <TableCell className="font-medium">
                          {step.stepLabel}
                        </TableCell>
                        <TableCell>{step.approverRole.name}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveStep(step.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() =>
                  openAddStep(flow.id, (flow.steps.at(-1)?.stepOrder ?? 0) + 1)
                }
              >
                <Plus className="mr-2 h-4 w-4" /> Add Step
              </Button>
            </CardContent>
          </Card>
        ))
      )}

      {/* Flow Dialog */}
      <Dialog open={flowDialogOpen} onOpenChange={setFlowDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editFlowId ? "Edit Flow" : "Create Approval Flow"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Flow Name</Label>
              <Input
                value={flowForm.name}
                onChange={(e) =>
                  setFlowForm({ ...flowForm, name: e.target.value })
                }
                placeholder="e.g. Engineering Approval Flow"
              />
            </div>
            {!editFlowId && (
              <div className="space-y-2">
                <Label>Department (optional)</Label>
                <Select
                  value={flowForm.departmentId}
                  items={departments.map((d) => ({ value: d.id, label: d.name }))}
                  onValueChange={(v) =>
                    setFlowForm({ ...flowForm, departmentId: v ?? "" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Default (all departments)" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Leave empty to create a default flow for all departments
                  without a specific one.
                </p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch
                checked={flowForm.isActive}
                onCheckedChange={(v) =>
                  setFlowForm({ ...flowForm, isActive: v })
                }
              />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFlowDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveFlow} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editFlowId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Step Dialog */}
      <Dialog open={stepDialogOpen} onOpenChange={setStepDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Approval Step</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Step Label</Label>
              <Input
                value={stepForm.stepLabel}
                onChange={(e) =>
                  setStepForm({ ...stepForm, stepLabel: e.target.value })
                }
                placeholder="e.g. Finance Manager Approval"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Step Order</Label>
                <Input
                  type="number"
                  value={stepForm.stepOrder}
                  onChange={(e) =>
                    setStepForm({
                      ...stepForm,
                      stepOrder: parseInt(e.target.value) || 1,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Approver Role</Label>
                <Select
                  value={stepForm.approverRoleId}
                  items={roles.map((r) => ({ value: r.id, label: r.name }))}
                  onValueChange={(v) =>
                    setStepForm({ ...stepForm, approverRoleId: v ?? "" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStepDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddStep} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Step
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
