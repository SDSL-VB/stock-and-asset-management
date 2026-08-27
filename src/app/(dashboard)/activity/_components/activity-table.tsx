"use client";

import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { getActivityLogs } from "@/lib/actions/activity";
import {
  ACTIVITY_CATEGORIES,
  type ActivityCategory,
} from "@/lib/activity-categories";

interface ActivityLog {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: string | null;
  createdAt: Date;
  user: { name: string; email: string };
}

const ACTION_COLORS: Record<string, string> = {
  CREATED: "bg-green-100 text-green-800",
  UPDATED: "bg-blue-100 text-blue-800",
  DELETED: "bg-red-100 text-red-800",
  ACTIVATED: "bg-emerald-100 text-emerald-800",
  DEACTIVATED: "bg-orange-100 text-orange-800",
  PASSWORD_RESET: "bg-purple-100 text-purple-800",
  PASSWORD_VIEWED: "bg-amber-100 text-amber-800",
};

const columns: ColumnDef<ActivityLog>[] = [
  {
    accessorKey: "user.name",
    header: "User",
    cell: ({ row }) => (
      <div>
        <p className="text-sm font-medium">{row.original.user.name}</p>
        <p className="text-xs text-muted-foreground">
          {row.original.user.email}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "action",
    header: "Action",
    cell: ({ row }) => (
      <Badge
        variant="secondary"
        className={`text-[10px] ${ACTION_COLORS[row.original.action] ?? ""}`}
      >
        {row.original.action}
      </Badge>
    ),
  },
  {
    accessorKey: "entity",
    header: "Entity",
    cell: ({ row }) => (
      <span className="text-sm">{row.original.entity}</span>
    ),
  },
  {
    accessorKey: "details",
    header: "Details",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.details ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "createdAt",
    header: "Date",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {new Date(row.original.createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    ),
  },
];

interface Props {
  logs: ActivityLog[];
  /** Departments for the department filter (admins only) */
  departments?: { id: string; name: string }[];
  /**
   * The parts of the log this person may read. Anything they cannot read is
   * not offered as a filter — a filter that returns nothing because of a
   * missing permission is worse than no filter at all.
   */
  allowedCategories?: ActivityCategory[];
}

export function ActivityTable({
  logs,
  departments = [],
  allowedCategories = [],
}: Props) {
  const categoryOptions = [
    // "All" only means something when there is more than one to combine
    ...(allowedCategories.length > 1
      ? [{ value: "all", label: "Everything you can see" }]
      : []),
    ...allowedCategories.map((key) => ({
      value: key,
      label: ACTIVITY_CATEGORIES[key].label,
    })),
  ];
  const [rows, setRows] = useState<ActivityLog[]>(logs);
  const [category, setCategory] = useState(
    allowedCategories.length === 1 ? allowedCategories[0] : "all"
  );
  const [departmentId, setDepartmentId] = useState("all");
  const [loading, setLoading] = useState(false);

  async function applyFilters(nextCategory: string, nextDepartment: string) {
    setCategory(nextCategory);
    setDepartmentId(nextDepartment);
    setLoading(true);
    try {
      const result = await getActivityLogs({
        limit: 50,
        category:
          nextCategory !== "all" ? (nextCategory as ActivityCategory) : undefined,
        departmentId: nextDepartment !== "all" ? nextDepartment : undefined,
      });
      setRows(result.logs);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {/* No categories readable means no filter worth showing */}
        {categoryOptions.length > 0 && (
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select
            value={category}
            items={categoryOptions}
            onValueChange={(v) => applyFilters(v ?? "all", departmentId)}
          >
            <SelectTrigger className="w-[210px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categoryOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        )}
        {departments.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs">Department</Label>
            <Select
              value={departmentId}
              items={[
                { value: "all", label: "All Departments" },
                ...departments.map((d) => ({ value: d.id, label: d.name })),
              ]}
              onValueChange={(v) => applyFilters(category, v ?? "all")}
            >
              <SelectTrigger className="w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {loading && <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <DataTable
        columns={columns}
        data={rows}
        searchKey="details"
        searchPlaceholder="Search activity..."
      />
    </div>
  );
}
