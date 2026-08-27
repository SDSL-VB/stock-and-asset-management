"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { restoreRecord, purgeRecord } from "@/lib/actions/recycle-bin";
import { RECYCLE_BIN_DAYS } from "@/lib/recycle-bin";
import { toast } from "sonner";
import { Search, Undo2, Trash2, Clock } from "lucide-react";

type Record = {
  id: string;
  entity: string;
  entityLabel: string;
  label: string;
  deletedByName: string;
  deletedAt: Date;
  expiresAt: Date;
  relinkCount: number;
};

interface Props {
  records: Record[];
  canRestore: boolean;
  canPurge: boolean;
}

/** "3 days left", or "today" on the last day. */
function daysLeft(expiresAt: Date): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  const days = Math.ceil(ms / 86_400_000);
  if (days <= 0) return "expires today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

export function RecycleBinList({ records, canRestore, canPurge }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [purging, setPurging] = useState<Record | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.entityLabel.toLowerCase().includes(q) ||
        r.deletedByName.toLowerCase().includes(q)
    );
  }, [records, search]);

  function restore(record: Record) {
    startTransition(async () => {
      const res = await restoreRecord(record.id);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`${record.label} restored`);
      router.refresh();
    });
  }

  function purge(record: Record) {
    startTransition(async () => {
      const res = await purgeRecord(record.id);
      setPurging(null);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`${record.label} removed for good`);
      router.refresh();
    });
  }

  if (records.length === 0) {
    return (
      <EmptyState
        emoji="🧹"
        title="Nothing deleted recently"
        description={`Anything you delete shows up here for ${RECYCLE_BIN_DAYS} days, so it can be put back.`}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name, kind or who deleted it"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState emoji="🔍" title="Nothing matches" description="Try a different search." />
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {filtered.map((r) => (
              <div
                key={r.id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-micro">
                      {r.entityLabel}
                    </Badge>
                    <span className="truncate font-medium">{r.label}</span>
                  </div>
                  <p className="mt-0.5 text-caption text-muted-foreground">
                    Deleted by {r.deletedByName} ·{" "}
                    {new Date(r.deletedAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {r.relinkCount > 0 &&
                      ` · ${r.relinkCount} linked record${r.relinkCount === 1 ? "" : "s"} would be re-attached`}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-caption text-muted-foreground tabular-nums">
                    <Clock className="h-3.5 w-3.5" />
                    {daysLeft(r.expiresAt)}
                  </span>
                  {canRestore && (
                    <Button size="sm" variant="outline" onClick={() => restore(r)} disabled={pending}>
                      <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                      Restore
                    </Button>
                  )}
                  {canPurge && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setPurging(r)}
                      disabled={pending}
                      aria-label={`Remove ${r.label} for good`}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {purging && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setPurging(null)}
          destructive
          title={`Remove ${purging.label} for good?`}
          description="This empties it from the recycle bin now, instead of waiting for it to age out. After this it cannot be restored."
          confirmLabel="Remove for good"
          onConfirm={() => purge(purging)}
        />
      )}
    </div>
  );
}
