"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeleteDialog } from "@/components/shared/delete-dialog";
import { cn } from "@/lib/utils";
import {
  KIND_LABEL,
  KIND_HINT,
  PRODUCT_KINDS,
  COMMON_UNITS,
  labelOfKind,
} from "@/lib/vocabulary";
import {
  saveBom,
  setProductKind,
  activateBomVersion,
  approveBom,
  rejectBom,
  deleteBom,
} from "@/lib/actions/bom";
import { getBuildReadiness, createBuild } from "@/lib/actions/builds";
import type { ExpandedLine } from "@/lib/bom-tree";
import {
  ArrowLeft,
  Plus,
  Trash2,
  CornerDownRight,
  AlertTriangle,
  Check,
  Hammer,
  Clock,
} from "lucide-react";

type Component = {
  id: string;
  code: string;
  name: string;
  unit: string;
  kind: string;
  category: { name: string };
};

type Version = {
  id: string;
  version: number;
  status: string;
  isActive: boolean;
  notes: string | null;
  rejectionReason: string | null;
  createdAt: Date;
  createdBy: { id: string; name: string };
  approvedBy: { name: string } | null;
  /** Null when written by someone with no department, e.g. an admin */
  authorDepartment: { id: string; name: string } | null;
  _count: { lines: number; builds: number };
  builds: { status: string }[];
  lines: {
    id: string;
    componentProductId: string;
    quantityPerUnit: number;
    isOptional: boolean;
    notes: string | null;
    component: {
      id: string;
      code: string;
      name: string;
      unit: string;
      category: { name: string };
    };
  }[];
};

type ReadinessLine = {
  componentProductId: string;
  code: string;
  name: string;
  unit: string;
  needed: number;
  available: number;
  short: number;
  isOptional: boolean;
  supports: number;
  estimatedCost: number | null;
};

interface Props {
  product: {
    id: string;
    code: string;
    name: string;
    kind: string;
    unit: string;
    category: { id: string; name: string; codePrefix: string | null };
  };
  versions: Version[];
  components: Component[];
  expanded: ExpandedLine[];
  locations: { id: string; name: string }[];
  currentUserId: string;
  canCreate: boolean;
  canEdit: boolean;
  canPublish: boolean;
  canApprove: boolean;
  /** The viewer's department — a manager reviews their own department's work */
  viewerDepartmentId: string | null;
  canDelete: boolean;
  canBuild: boolean;
  canSetBatch: boolean;
  canEditProduct: boolean;
  canSeeValue: boolean;
}

type DraftLine = {
  key: string;
  componentProductId: string;
  quantity: string;
  isOptional: boolean;
  notes: string;
};

let keySeed = 0;
const nextKey = () => `line-${keySeed++}`;

const STATUS_STYLES: Record<string, string> = {
  PUBLISHED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  PENDING: "border-amber-200 bg-amber-50 text-amber-900",
  REJECTED: "border-red-200 bg-red-50 text-red-800",
  DRAFT: "border-slate-200 bg-slate-50 text-slate-700",
};

const STATUS_LABELS: Record<string, string> = {
  PUBLISHED: "published",
  PENDING: "awaiting approval",
  REJECTED: "sent back",
  DRAFT: "draft",
};

/** Builds that were undone hold no claim on a version — only live ones count. */
function liveBuilds(v: Version) {
  return v.builds.filter((b) => b.status === "COMPLETED").length;
}

/** 2 not 2.0000000001, 0.5 not 0.50 */
function formatQty(n: number) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

function toDraft(version: Version | undefined): DraftLine[] {
  if (!version) return [];
  return version.lines.map((l) => ({
    key: nextKey(),
    componentProductId: l.componentProductId,
    quantity: String(l.quantityPerUnit),
    isOptional: l.isOptional,
    notes: l.notes ?? "",
  }));
}

export function BomWorkbench({
  product,
  versions,
  components,
  expanded,
  locations,
  currentUserId,
  canCreate,
  canEdit,
  canPublish,
  canApprove,
  viewerDepartmentId,
  canDelete,
  canBuild,
  canSetBatch,
  canEditProduct,
  canSeeValue,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // What to load into the editor: whatever is in force, else whatever this
  // person has waiting or was sent back
  const live = versions.find((v) => v.isActive && v.status === "PUBLISHED");
  const mine = versions.find(
    (v) => ["PENDING", "REJECTED", "DRAFT"].includes(v.status) && v.createdBy.id === currentUserId
  );
  const editing = mine ?? live;
  // Only submissions this person may actually act on. A version from another
  // department goes to that department's manager, so its buttons are absent
  // here rather than present and refused on click.
  const awaiting = versions.filter(
    (v) =>
      v.status === "PENDING" &&
      (v.authorDepartment === null || v.authorDepartment.id === viewerDepartmentId)
  );

  const [lines, setLines] = useState<DraftLine[]>(() => toDraft(editing));
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [kind, setKind] = useState(product.kind);
  const [unit, setUnit] = useState(product.unit);

  // Build tab
  const [buildQty, setBuildQty] = useState("1");
  const [buildLocation, setBuildLocation] = useState(locations[0]?.id ?? "");
  const [buildNotes, setBuildNotes] = useState("");
  const [buildBatch, setBuildBatch] = useState("");
  const [readiness, setReadiness] = useState<{
    lines: ReadinessLine[];
    canBuild: boolean;
    maxBuildable: number;
    bomVersion: number;
    estimatedCost: number | null;
  } | null>(null);

  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [deleting, setDeleting] = useState<Version | null>(null);

  const componentItems = useMemo(
    () => components.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` })),
    [components]
  );
  const byId = useMemo(() => new Map(components.map((c) => [c.id, c])), [components]);
  const writable = canEdit || canCreate;

  function flash(message: string) {
    setSaved(message);
    setError(null);
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      { key: nextKey(), componentProductId: "", quantity: "1", isOptional: false, notes: "" },
    ]);
  }

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function save(asNewVersion: boolean) {
    setError(null);
    setSaved(null);

    const payload = {
      notes,
      lines: lines.map((l) => ({
        componentProductId: l.componentProductId,
        quantityPerUnit: Number(l.quantity),
        isOptional: l.isOptional,
        notes: l.notes,
      })),
    };

    if (payload.lines.some((l) => !l.componentProductId)) {
      setError("Every row needs a component picked.");
      return;
    }
    if (payload.lines.some((l) => !Number.isFinite(l.quantityPerUnit) || l.quantityPerUnit <= 0)) {
      setError("Every quantity must be a number greater than zero.");
      return;
    }

    startTransition(async () => {
      const res = await saveBom(product.id, payload, { asNewVersion });
      if (res?.error) return setError(res.error);
      flash(
        res.created
          ? res.published
            ? `Published version ${res.version}.`
            : `Version ${res.version} sent for approval.`
          : `Version ${res.version} updated.`
      );
      router.refresh();
    });
  }

  function saveKind() {
    setError(null);
    startTransition(async () => {
      const res = await setProductKind(product.id, { kind, unit });
      if (res?.error) return setError(res.error);
      flash("Product details saved.");
      router.refresh();
    });
  }

  function activate(bomId: string) {
    startTransition(async () => {
      const res = await activateBomVersion(bomId);
      if (res?.error) return setError(res.error);
      flash("That version is now in force.");
      router.refresh();
    });
  }

  function approve(bomId: string) {
    startTransition(async () => {
      const res = await approveBom(bomId);
      if (res?.error) return setError(res.error);
      flash("Approved and published.");
      router.refresh();
    });
  }

  function reject(bomId: string) {
    startTransition(async () => {
      const res = await rejectBom(bomId, rejectNote);
      if (res?.error) return setError(res.error);
      setRejecting(null);
      setRejectNote("");
      flash("Sent back to its author.");
      router.refresh();
    });
  }

  function checkReadiness() {
    setError(null);
    const qty = Number(buildQty);
    if (!Number.isFinite(qty) || qty < 1) return setError("How many are you building?");
    if (!buildLocation) return setError("Pick the site building it.");

    startTransition(async () => {
      const res = await getBuildReadiness(product.id, Math.floor(qty), buildLocation);
      if (!res.ok) {
        setReadiness(null);
        return setError(res.error);
      }
      setReadiness({
        lines: res.lines,
        canBuild: res.canBuild,
        maxBuildable: res.maxBuildable,
        bomVersion: res.bomVersion,
        estimatedCost: res.estimatedCost,
      });
    });
  }

  function build() {
    setError(null);
    startTransition(async () => {
      const res = await createBuild({
        productId: product.id,
        quantity: Math.floor(Number(buildQty)),
        locationId: buildLocation,
        notes: buildNotes,
        batchNumber: buildBatch,
      });
      if (res?.error) return setError(res.error);
      setReadiness(null);
      setBuildNotes("");
      setBuildBatch("");
      flash(
        `Built ${buildQty} × ${product.name} as ${res.buildNumber ?? "a new build"}. It is now in central stock and can be dispatched.`
      );
      router.refresh();
    });
  }

  function removeVersion(version: Version, force: boolean) {
    startTransition(async () => {
      const res = await deleteBom(version.id, { force });
      if (res?.error) {
        setDeleting(null);
        return setError(res.error);
      }
      if ("needsConfirmation" in res && res.needsConfirmation) return; // dialog handles it
      setDeleting(null);
      flash(`Version ${version.version} deleted.`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href="/bom"
          className="inline-flex items-center gap-1.5 text-caption text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All bills of materials
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">
          <span className="font-mono text-muted-foreground">{product.code}</span> {product.name}
        </h1>
        <p className="text-caption text-muted-foreground">
          {product.category.name} ·{" "}
          {labelOfKind(product.kind)} ·
          measured in {product.unit}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {saved && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <Check className="h-4 w-4 shrink-0" />
          <span>{saved}</span>
        </div>
      )}

      {editing?.status === "REJECTED" && editing.rejectionReason && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900">
          <strong>Sent back:</strong> {editing.rejectionReason}
        </div>
      )}

      <Tabs defaultValue="components">
        <TabsList>
          <TabsTrigger value="components">Components</TabsTrigger>
          <TabsTrigger value="tree">Full breakdown</TabsTrigger>
          {canBuild && <TabsTrigger value="build">Build</TabsTrigger>}
          {canApprove && awaiting.length > 0 && (
            <TabsTrigger value="approvals">Approvals ({awaiting.length})</TabsTrigger>
          )}
          {versions.length > 0 && <TabsTrigger value="history">Versions</TabsTrigger>}
        </TabsList>

        {/* ---------------------------------------------------- components */}
        <TabsContent value="components" className="space-y-4 pt-4">
          {canEditProduct && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">What this product is</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end gap-4">
                <div className="min-w-[240px] flex-1 space-y-1.5">
                  <Label>Kind</Label>
                  <Select
                    value={kind}
                    items={PRODUCT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
                    onValueChange={(v) => setKind((v as string) ?? product.kind)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRODUCT_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {KIND_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-micro text-muted-foreground">
                    {KIND_HINT[kind as keyof typeof KIND_HINT]}
                  </p>
                </div>
                <div className="w-[160px] space-y-1.5">
                  <Label htmlFor="unit">Measured in</Label>
                  <Input
                    id="unit"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    list="unit-suggestions"
                    placeholder="pcs"
                  />
                  <datalist id="unit-suggestions">
                    {COMMON_UNITS.map((u) => (
                      <option key={u} value={u} />
                    ))}
                  </datalist>
                </div>
                <Button
                  variant="outline"
                  onClick={saveKind}
                  disabled={pending || (kind === product.kind && unit === product.unit)}
                >
                  Save
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                Components
                {editing && (
                  <Badge
                    variant="outline"
                    className={cn("text-micro", STATUS_STYLES[editing.status])}
                  >
                    version {editing.version} · {STATUS_LABELS[editing.status] ?? editing.status}
                  </Badge>
                )}
              </CardTitle>
              {writable && (
                <Button size="sm" variant="outline" onClick={addLine}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add component
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {lines.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {writable
                    ? "No components yet. Add the first one to start."
                    : "This product has no bill of materials yet."}
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="hidden grid-cols-[1fr_120px_110px_1fr_40px] gap-3 px-1 text-micro font-bold uppercase tracking-[0.1em] text-muted-foreground md:grid">
                    <span>Component</span>
                    <span>Qty per unit</span>
                    <span>Optional</span>
                    <span>Note</span>
                    <span />
                  </div>
                  {lines.map((line) => {
                    const picked = byId.get(line.componentProductId);
                    return (
                      <div
                        key={line.key}
                        className="grid grid-cols-1 gap-3 rounded-lg border p-3 md:grid-cols-[1fr_120px_110px_1fr_40px] md:items-center md:border-0 md:p-1"
                      >
                        <Select
                          value={line.componentProductId}
                          items={componentItems}
                          onValueChange={(v) =>
                            updateLine(line.key, { componentProductId: (v as string) ?? "" })
                          }
                          disabled={!writable}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Pick a component" />
                          </SelectTrigger>
                          <SelectContent>
                            {components.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.code} — {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <div className="flex items-center gap-1.5">
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            value={line.quantity}
                            onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                            disabled={!writable}
                            className="tabular-nums"
                          />
                          <span className="shrink-0 text-caption text-muted-foreground">
                            {picked?.unit ?? ""}
                          </span>
                        </div>

                        <label className="flex items-center gap-2 text-caption text-muted-foreground">
                          <Checkbox
                            checked={line.isOptional}
                            onCheckedChange={(c) => updateLine(line.key, { isOptional: c === true })}
                            disabled={!writable}
                          />
                          Add-on
                        </label>

                        <Input
                          value={line.notes}
                          onChange={(e) => updateLine(line.key, { notes: e.target.value })}
                          placeholder="Optional note"
                          disabled={!writable}
                        />

                        {writable ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => removeLine(line.key)}
                            aria-label="Remove component"
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        ) : (
                          <span />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {writable && (
                <div className="space-y-1.5 pt-2">
                  <Label htmlFor="bom-notes">Notes on this version</Label>
                  <Textarea
                    id="bom-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="What changed, or anything the shop floor should know"
                    rows={2}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {writable && (
            <div className="flex flex-wrap items-center gap-3">
              {canEdit && editing && (
                <Button onClick={() => save(false)} disabled={pending || lines.length === 0}>
                  Save changes to version {editing.version}
                </Button>
              )}
              {canCreate && (
                <Button
                  variant={canEdit && editing ? "outline" : "default"}
                  onClick={() => save(true)}
                  disabled={pending || lines.length === 0}
                >
                  {canPublish
                    ? editing
                      ? `Publish as version ${editing.version + 1}`
                      : "Publish"
                    : "Submit for approval"}
                </Button>
              )}
              <p className="text-caption text-muted-foreground">
                {canPublish
                  ? "Correct a mistake in place. Publish a new version when the design really changed — anything already built keeps pointing at the old one."
                  : "Submitting sends it to a manager. Nothing is built to it until they approve."}
              </p>
            </div>
          )}
        </TabsContent>

        {/* ------------------------------------------------------- breakdown */}
        <TabsContent value="tree" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                Everything needed for one {product.unit === "pcs" ? "unit" : product.unit}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {expanded.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nothing to break down yet.
                </p>
              ) : (
                <div className="space-y-1">
                  {expanded.map((line, i) => (
                    <div
                      key={`${line.productId}-${i}`}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm odd:bg-muted/30"
                      style={{ paddingLeft: `${0.5 + line.depth * 1.25}rem` }}
                    >
                      {line.depth > 0 && (
                        <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="font-mono text-caption text-muted-foreground">
                        {line.code}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{line.name}</span>
                      {line.isOptional && (
                        <Badge variant="outline" className="text-micro">
                          add-on
                        </Badge>
                      )}
                      {line.hasOwnBom && (
                        <Badge variant="outline" className="text-micro">
                          made here
                        </Badge>
                      )}
                      <span className="shrink-0 tabular-nums">
                        {formatQty(line.quantity)} {line.unit}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ----------------------------------------------------------- build */}
        {canBuild && (
          <TabsContent value="build" className="space-y-4 pt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Build this product</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Building takes the components out of central stock and puts the assembled product
                  in. After that, dispatch offers the product as a whole — and whatever was left
                  over as itself.
                </p>

                <div className="flex flex-wrap items-end gap-4">
                  <div className="w-[140px] space-y-1.5">
                    <Label htmlFor="build-qty">How many</Label>
                    <Input
                      id="build-qty"
                      type="number"
                      min="1"
                      step="1"
                      value={buildQty}
                      onChange={(e) => {
                        setBuildQty(e.target.value);
                        setReadiness(null);
                      }}
                      className="tabular-nums"
                    />
                  </div>
                  <div className="min-w-[200px] flex-1 space-y-1.5">
                    <Label>Built at</Label>
                    <Select
                      value={buildLocation}
                      items={locations.map((l) => ({ value: l.id, label: l.name }))}
                      onValueChange={(v) => {
                        setBuildLocation((v as string) ?? "");
                        setReadiness(null);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pick a site" />
                      </SelectTrigger>
                      <SelectContent>
                        {locations.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {canSetBatch && (
                    <div className="min-w-[220px] flex-1 space-y-1.5">
                      <Label htmlFor="build-batch">Batch number</Label>
                      <Input
                        id="build-batch"
                        value={buildBatch}
                        onChange={(e) => setBuildBatch(e.target.value)}
                        placeholder="Leave empty to use the build number"
                      />
                    </div>
                  )}
                  <Button variant="outline" onClick={checkReadiness} disabled={pending}>
                    Check what it needs
                  </Button>
                </div>
                {canSetBatch && (
                  <p className="-mt-2 text-caption text-muted-foreground">
                    A recall follows whatever goes here. Leave it empty and the build number is
                    used, so there is always something to trace.
                  </p>
                )}

                {readiness && (
                  <div className="space-y-3">
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/40 text-micro font-bold uppercase tracking-[0.1em] text-muted-foreground">
                            <th className="px-3 py-2 text-left">Component</th>
                            <th className="px-3 py-2 text-right">Need</th>
                            <th className="px-3 py-2 text-right">Available</th>
                            <th className="px-3 py-2 text-left">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {readiness.lines.map((l) => (
                            <tr key={l.componentProductId} className="border-b last:border-0">
                              <td className="px-3 py-2">
                                <span className="font-mono text-caption text-muted-foreground">
                                  {l.code}
                                </span>{" "}
                                {l.name}
                                {l.isOptional && (
                                  <Badge variant="outline" className="ml-2 text-micro">
                                    add-on
                                  </Badge>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatQty(l.needed)} {l.unit}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatQty(l.available)} {l.unit}
                              </td>
                              <td
                                className={cn(
                                  "px-3 py-2",
                                  l.short > 0
                                    ? l.isOptional
                                      ? "text-muted-foreground"
                                      : "font-semibold text-destructive"
                                    : "text-emerald-700"
                                )}
                              >
                                {l.short > 0
                                  ? `Short by ${formatQty(l.short)} ${l.unit}`
                                  : "Ready"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {readiness.canBuild ? (
                        <Button onClick={build} disabled={pending}>
                          <Hammer className="mr-1.5 h-4 w-4" />
                          Build {buildQty} × {product.name}
                        </Button>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Not enough on hand.{" "}
                          {readiness.maxBuildable > 0
                            ? `The most you could build right now is ${readiness.maxBuildable}.`
                            : "Nothing can be built until stock arrives."}
                        </p>
                      )}
                      {canSeeValue && readiness.estimatedCost !== null && (
                        <span className="text-caption text-muted-foreground tabular-nums">
                          Component cost ≈ ₹{readiness.estimatedCost.toLocaleString("en-IN")}
                        </span>
                      )}
                      <span className="text-caption text-muted-foreground">
                        Built to version {readiness.bomVersion}
                      </span>
                    </div>

                    {readiness.canBuild && (
                      <div className="space-y-1.5">
                        <Label htmlFor="build-notes">Notes (optional)</Label>
                        <Input
                          id="build-notes"
                          value={buildNotes}
                          onChange={(e) => setBuildNotes(e.target.value)}
                          placeholder="Anything worth recording about this run"
                        />
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ------------------------------------------------------- approvals */}
        {canApprove && awaiting.length > 0 && (
          <TabsContent value="approvals" className="space-y-3 pt-4">
            {awaiting.map((v) => (
              <Card key={v.id} className="border-amber-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-amber-600" />
                    Version {v.version} from {v.createdBy.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    {v.lines.map((l) => (
                      <div key={l.id} className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-caption text-muted-foreground">
                          {l.component.code}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{l.component.name}</span>
                        {l.isOptional && (
                          <Badge variant="outline" className="text-micro">
                            add-on
                          </Badge>
                        )}
                        <span className="tabular-nums">
                          {formatQty(l.quantityPerUnit)} {l.component.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                  {v.notes && <p className="text-caption text-muted-foreground">{v.notes}</p>}

                  {rejecting === v.id ? (
                    <div className="space-y-2">
                      <Label htmlFor={`reject-${v.id}`}>What needs fixing?</Label>
                      <Textarea
                        id={`reject-${v.id}`}
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        rows={2}
                        placeholder="The author sees this note"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => reject(v.id)}
                          disabled={pending}
                        >
                          Send it back
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRejecting(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => approve(v.id)} disabled={pending}>
                        Approve and publish
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setRejecting(v.id)}>
                        Send back
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        )}

        {/* --------------------------------------------------------- history */}
        {versions.length > 0 && (
          <TabsContent value="history" className="space-y-3 pt-4">
            {versions.map((v) => (
              <Card key={v.id} className={cn(v.isActive && "border-primary/40")}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">Version {v.version}</span>
                      <Badge
                        variant="outline"
                        className={cn("text-micro", STATUS_STYLES[v.status])}
                      >
                        {v.isActive && v.status === "PUBLISHED"
                          ? "in force"
                          : (STATUS_LABELS[v.status] ?? v.status)}
                      </Badge>
                      {liveBuilds(v) > 0 && (
                        <Badge variant="outline" className="text-micro">
                          built {liveBuilds(v)}×
                        </Badge>
                      )}
                    </div>
                    <p className="text-caption text-muted-foreground">
                      {v._count.lines} component{v._count.lines === 1 ? "" : "s"} ·{" "}
                      {v.createdBy.name}
                      {v.approvedBy ? ` · approved by ${v.approvedBy.name}` : ""} ·{" "}
                      {new Date(v.createdAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                    {v.notes && <p className="mt-1 text-caption">{v.notes}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canEdit && !v.isActive && v.status === "PUBLISHED" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => activate(v.id)}
                        disabled={pending}
                      >
                        Put back in force
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleting(v)}
                        disabled={pending}
                        aria-label={`Delete version ${v.version}`}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        )}
      </Tabs>

      {deleting && (
        <DeleteDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          name={`version ${deleting.version}`}
          consequence={`This permanently removes version ${deleting.version} of the bill of materials for ${product.code}, with its ${deleting._count.lines} component${deleting._count.lines === 1 ? "" : "s"}.`}
          blockedReason={
            liveBuilds(deleting) > 0
              ? `Version ${deleting.version} was used to build ${liveBuilds(deleting)} time${liveBuilds(deleting) === 1 ? "" : "s"}. Deleting it would leave those builds unable to say what they consumed.`
              : null
          }
          deactivateHint={
            deleting.isActive
              ? "Publish a corrected version instead — this one is retired automatically and stays readable."
              : "Older versions cost nothing to keep, and they are what past builds point at."
          }
          onDelete={() => removeVersion(deleting, true)}
        />
      )}
    </div>
  );
}
