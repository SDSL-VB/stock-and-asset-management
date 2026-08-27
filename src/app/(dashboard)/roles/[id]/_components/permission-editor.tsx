"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { updateRolePermissions } from "@/lib/actions/roles";
import {
  missingDependencies,
  reasonFor,
  dependentsOf,
} from "@/lib/rbac/permission-dependencies";
import {
  LinkedPermissionsDialog,
  type LinkedPrompt,
} from "@/components/shared/linked-permissions-dialog";
import { toast } from "sonner";
import {
  Contact,
  Send,
  Truck,
  Save,
  Loader2,
  CheckSquare,
  Square,
  Users,
  Shield,
  Building2,
  Activity,
  Settings,
  Package,
  BarChart3,
  Box,
  Tags,
  Inbox,
  Eye,
  Pencil,
  Plus,
  Trash2,
  Check,
  ChevronRight,
  Layers,
  Wrench,
  Hammer,
  type LucideIcon,
} from "lucide-react";

interface Permission {
  id: string;
  key: string;
  name: string;
  description: string | null;
  module: string;
}

interface Props {
  roleId: string;
  roleName: string;
  allPermissions: Permission[];
  currentPermissionIds: string[];
  canEdit: boolean;
}

const MODULE_CONFIG: Record<string, { label: string; icon: LucideIcon; description: string; color: string }> = {
  users: {
    label: "Team Members",
    icon: Users,
    description: "Manage user accounts, profiles, and status",
    color: "text-blue-600 bg-blue-50",
  },
  roles: {
    label: "Roles & Permissions",
    icon: Shield,
    description: "Configure roles and assign permissions",
    color: "text-purple-600 bg-purple-50",
  },
  vendors: {
    label: "Vendors",
    icon: Truck,
    description: "Manage suppliers we buy from and their GST details",
    color: "text-amber-600 bg-amber-50",
  },
  dispatch: {
    label: "Dispatch",
    icon: Send,
    description: "Outgoing consignments to other locations and to clients",
    color: "text-sky-600 bg-sky-50",
  },
  clients: {
    label: "Clients",
    icon: Contact,
    description: "Manage customers we dispatch to and their GST details",
    color: "text-teal-600 bg-teal-50",
  },
  departments: {
    label: "Departments",
    icon: Building2,
    description: "Manage departments and team structure",
    color: "text-indigo-600 bg-indigo-50",
  },
  products: {
    label: "Product Catalog",
    icon: Tags,
    description: "View, search, and manage product codes",
    color: "text-teal-600 bg-teal-50",
  },
  stock: {
    label: "Stock Management",
    icon: Package,
    description: "Create, edit, approve, and configure stock entries",
    color: "text-emerald-600 bg-emerald-50",
  },
  requests: {
    label: "Requests",
    icon: Inbox,
    description: "View and raise transfer and product requests",
    color: "text-rose-600 bg-rose-50",
  },
  reports: {
    label: "Reports & Analytics",
    icon: BarChart3,
    description: "View and export stock reports",
    color: "text-amber-600 bg-amber-50",
  },
  bom: {
    label: "Bills of Materials",
    icon: Layers,
    description: "What a product is made of, and building it from its components",
    color: "text-violet-600 bg-violet-50",
  },
  config: {
    label: "Configuration",
    icon: Wrench,
    description: "Approval rules and other system-wide settings",
    color: "text-slate-600 bg-slate-100",
  },
  activity: {
    label: "Activity Log",
    icon: Activity,
    description: "View system activity and audit trail",
    color: "text-cyan-600 bg-cyan-50",
  },
  settings: {
    label: "Settings",
    icon: Settings,
    description: "Access application settings",
    color: "text-gray-600 bg-gray-100",
  },
  assets: {
    label: "Assets",
    icon: Box,
    description: "Manage assets and transfers",
    color: "text-orange-600 bg-orange-50",
  },
};

const MODULE_ORDER = [
  "users",
  "roles",
  "departments",
  "clients",
  "vendors",
  "products",
  "bom",
  "stock",
  "assets",
  "dispatch",
  "requests",
  "reports",
  "activity",
  "config",
  "settings",
];

// Map permission action keywords to icons
function getPermissionIcon(key: string): LucideIcon {
  // Building is neither reading nor writing, so it gets its own mark
  if (key === "bom.build" || key === "bom.unbuild") return Hammer;
  if (key.includes("view")) return Eye;
  if (key.includes("create")) return Plus;
  if (key.includes("edit") || key.includes("configure") || key.includes("approve") || key.includes("transfer") || key.includes("manage")) return Pencil;
  if (key.includes("delete") || key.includes("export")) return Trash2;
  return Check;
}

export function PermissionEditor({
  roleId,
  roleName,
  allPermissions,
  currentPermissionIds,
  canEdit,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    new Set(currentPermissionIds)
  );
  const [isPending, startTransition] = useTransition();
  // Raised when a permission is granted that cannot work on its own
  const [linkPrompt, setLinkPrompt] = useState<LinkedPrompt | null>(null);

  const byKey = new Map(allPermissions.map((p) => [p.key, p]));
  const byId = new Map(allPermissions.map((p) => [p.id, p]));

  /** Keys currently ticked, for asking what a new one still needs. */
  function heldKeys(ids: Set<string>): Set<string> {
    const keys = new Set<string>();
    for (const id of ids) {
      const p = byId.get(id);
      if (p) keys.add(p.key);
    }
    return keys;
  }

  const modules = Array.from(
    new Set(allPermissions.map((p) => p.module))
  ).sort((a, b) => {
    const ai = MODULE_ORDER.indexOf(a);
    const bi = MODULE_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const [activeModule, setActiveModule] = useState<string>(modules[0] ?? "");

  const totalPermissions = allPermissions.length;
  const selectedCount = selected.size;

  const hasChanges =
    selected.size !== currentPermissionIds.length ||
    !currentPermissionIds.every((id) => selected.has(id));

  const togglePermission = (id: string) => {
    const permission = byId.get(id);
    const next = new Set(selected);

    if (next.has(id)) {
      // Untick: warn if anything still ticked depends on it, since removing it
      // quietly breaks those rather than this one.
      next.delete(id);
      setSelected(next);

      if (permission) {
        const stillHeld = heldKeys(next);
        const orphaned = dependentsOf(permission.key).filter((k) => stillHeld.has(k));
        if (orphaned.length > 0) {
          toast.warning(
            `${orphaned.length} other permission${orphaned.length === 1 ? "" : "s"} needed "${permission.name}" — ${orphaned.join(", ")}`
          );
        }
      }
      return;
    }

    next.add(id);

    // Tick: if it cannot work alone, say so before it is saved
    if (permission) {
      const missingKeys = missingDependencies(permission.key, heldKeys(next));
      if (missingKeys.length > 0) {
        setLinkPrompt({
          key: permission.key,
          name: permission.name,
          reason: reasonFor(permission.key) ?? "It depends on another permission.",
          missing: missingKeys.map((k) => ({
            key: k,
            name: byKey.get(k)?.name ?? k,
          })),
        });
        // Held back until the prompt is answered, so cancelling leaves it unticked
        setPendingGrant(next);
        return;
      }
    }

    setSelected(next);
  };

  /** The selection waiting on an answer from the linked-permissions prompt */
  const [pendingGrant, setPendingGrant] = useState<Set<string> | null>(null);

  function resolveLinked(mode: "all" | "only" | "cancel") {
    if (mode === "cancel" || !pendingGrant || !linkPrompt) {
      setLinkPrompt(null);
      setPendingGrant(null);
      return;
    }

    const next = new Set(pendingGrant);
    if (mode === "all") {
      for (const m of linkPrompt.missing) {
        const dep = byKey.get(m.key);
        if (dep) next.add(dep.id);
      }
    }
    setSelected(next);
    setLinkPrompt(null);
    setPendingGrant(null);
  }

  const toggleModule = (module: string) => {
    const modulePerms = allPermissions.filter((p) => p.module === module);
    const allSelected = modulePerms.every((p) => selected.has(p.id));

    const next = new Set(selected);
    if (allSelected) {
      modulePerms.forEach((p) => next.delete(p.id));
      setSelected(next);
      return;
    }

    modulePerms.forEach((p) => next.add(p.id));

    // Granting a whole module pulls in what it depends on rather than asking
    // once per permission — twelve prompts in a row would just be dismissed.
    const pulled: string[] = [];
    for (const p of modulePerms) {
      for (const key of missingDependencies(p.key, heldKeys(next))) {
        const dep = byKey.get(key);
        if (dep && !next.has(dep.id)) {
          next.add(dep.id);
          pulled.push(dep.name);
        }
      }
    }
    setSelected(next);

    if (pulled.length > 0) {
      toast.info(
        `Also added ${[...new Set(pulled)].join(", ")} — ${moduleMeta(module).label} needs ${pulled.length === 1 ? "it" : "them"}`
      );
    }
  };

  const selectAll = () => setSelected(new Set(allPermissions.map((p) => p.id)));
  const deselectAll = () => setSelected(new Set());

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateRolePermissions(
        roleId,
        Array.from(selected)
      );
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Permissions updated for "${roleName}"`);
    });
  };

  const overallPercent = Math.round((selectedCount / totalPermissions) * 100);

  function moduleMeta(module: string) {
    return (
      MODULE_CONFIG[module] ?? {
        label: module,
        icon: Shield,
        description: "",
        color: "text-gray-600 bg-gray-100",
      }
    );
  }

  const activeMeta = moduleMeta(activeModule);
  const ActiveIcon = activeMeta.icon;
  const activePerms = allPermissions.filter((p) => p.module === activeModule);
  const activeAllSelected = activePerms.length > 0 && activePerms.every((p) => selected.has(p.id));

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium">
                Permissions for <span className="text-brand-green">{roleName}</span>
              </span>
              <Badge variant="outline" className="text-xs">
                {selectedCount} / {totalPermissions} ({overallPercent}%)
              </Badge>
            </div>
            {canEdit && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  <CheckSquare className="mr-1.5 h-3.5 w-3.5" />
                  All
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAll}>
                  <Square className="mr-1.5 h-3.5 w-3.5" />
                  None
                </Button>
              </div>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-brand-green transition-all duration-300"
              style={{ width: `${overallPercent}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Pick a module on the left, then grant individual permissions on the right.
            The switch grants or clears a whole module at once.
          </p>
        </CardContent>
      </Card>

      {/*
        Master–detail. From lg upward both panels are pinned to the viewport and
        scroll inside themselves, so the module list never runs away from the
        permissions you are ticking — with 79 permissions across a dozen modules,
        a single page scroll meant losing sight of one while working in the other.
        Below lg they stack and grow naturally, which is what a phone wants.
      */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(17rem,22rem)_1fr]">
        {/* Module list */}
        <Card
          className={cn(
            "overflow-hidden",
            "lg:sticky lg:top-[4.5rem] lg:flex lg:h-[calc(100vh-7.5rem)] lg:flex-col"
          )}
        >
          <div className="divide-y lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {modules.map((module) => {
              const meta = moduleMeta(module);
              const ModuleIcon = meta.icon;
              const modulePerms = allPermissions.filter((p) => p.module === module);
              const selectedInModule = modulePerms.filter((p) => selected.has(p.id)).length;
              const allSelected = selectedInModule === modulePerms.length;
              const someSelected = selectedInModule > 0;
              const isActive = module === activeModule;

              return (
                <div
                  key={module}
                  className={cn(
                    "flex w-full items-center gap-3 p-3 text-left transition-colors cursor-pointer",
                    isActive ? "bg-brand-green/10" : "hover:bg-muted/60"
                  )}
                  onClick={() => setActiveModule(module)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setActiveModule(module);
                  }}
                >
                  <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", meta.color)}>
                    <ModuleIcon className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm", isActive ? "font-semibold" : "font-medium")}>
                      {meta.label}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {selectedInModule}/{modulePerms.length} granted
                    </p>
                  </div>
                  <span onClick={(e) => e.stopPropagation()}>
                    <Switch
                      checked={allSelected}
                      onCheckedChange={() => toggleModule(module)}
                      disabled={!canEdit}
                      aria-label={`Grant all ${meta.label} permissions`}
                    />
                  </span>
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 shrink-0",
                      isActive ? "text-brand-green" : "text-muted-foreground/40",
                      someSelected && !allSelected && !isActive && "text-amber-400"
                    )}
                  />
                </div>
              );
            })}
          </div>
        </Card>

        {/* Permission panel for the active module */}
        <Card
          className={cn(
            "overflow-hidden",
            "lg:sticky lg:top-[4.5rem] lg:flex lg:h-[calc(100vh-7.5rem)] lg:flex-col"
          )}
        >
          <CardContent className="space-y-3 p-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
            {/* Stays put while the list below it scrolls */}
            <div className="flex flex-wrap items-center justify-between gap-2 lg:shrink-0">
              <div className="flex items-center gap-3">
                <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", activeMeta.color)}>
                  <ActiveIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{activeMeta.label}</p>
                  <p className="text-xs text-muted-foreground">{activeMeta.description}</p>
                </div>
              </div>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => toggleModule(activeModule)}
                >
                  {activeAllSelected ? (
                    <>
                      <Square className="mr-1 h-3 w-3" />
                      Clear All
                    </>
                  ) : (
                    <>
                      <CheckSquare className="mr-1 h-3 w-3" />
                      Grant All
                    </>
                  )}
                </Button>
              )}
            </div>

            <div className="space-y-2 lg:-mr-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
              {activePerms.map((perm) => {
                const PermIcon = getPermissionIcon(perm.key);
                const isSelected = selected.has(perm.id);

                return (
                  <div
                    key={perm.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-all",
                      isSelected
                        ? "border-brand-green/20 bg-brand-green/5 shadow-sm"
                        : "hover:bg-muted/50",
                      !canEdit && "cursor-default"
                    )}
                    onClick={() => canEdit && togglePermission(perm.id)}
                  >
                    <Checkbox
                      id={perm.id}
                      checked={isSelected}
                      onCheckedChange={() => togglePermission(perm.id)}
                      disabled={!canEdit}
                      className={cn(isSelected && "border-brand-green data-[state=checked]:bg-brand-green")}
                    />
                    <div className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                      isSelected ? "bg-brand-green/10 text-brand-green" : "bg-muted text-muted-foreground"
                    )}>
                      <PermIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Label
                        htmlFor={perm.id}
                        className={cn(
                          "cursor-pointer text-sm font-medium",
                          isSelected ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {perm.name}
                      </Label>
                      {perm.description && (
                        <p className="text-xs text-muted-foreground">
                          {perm.description}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
              {activePerms.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No permissions in this module.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <LinkedPermissionsDialog
        prompt={linkPrompt}
        onGrantAll={() => resolveLinked("all")}
        onGrantAnyway={() => resolveLinked("only")}
        onCancel={() => resolveLinked("cancel")}
      />

      {canEdit && hasChanges && (
        <div className="sticky bottom-4 z-10">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3 shadow-lg">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
              <span className="text-sm text-muted-foreground">
                You have unsaved permission changes
              </span>
            </div>
            <Button
              onClick={handleSave}
              disabled={isPending}
              className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Permissions
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
