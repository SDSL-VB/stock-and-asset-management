"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileDown, ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ExportButton } from "@/components/shared/export-button";
import { exportNeedListCsv, exportNeedListPdf, getNeedList } from "@/lib/actions/needs";
import { toneStyles, type StatusTone } from "@/lib/design/status";
import { formatDateTime } from "@/lib/format";
import { NEED_STATUS_LABEL } from "@/lib/vocabulary";

/**
 * A need request, opened from any of its needs in the Needs table.
 *
 * Needs raised together — everything a build was short of, or everything
 * running low at a site — share a list number. Each of those rows in the Needs
 * table carries the number as a small button; pressing it shows the whole list
 * with every need's current status, and the CSV and PDF downloads a buyer
 * takes to a vendor. There is no separate list of lists: the needs are the
 * list, grouped.
 *
 * The list loads when opened, so the table carries only its number.
 *
 * `canDownload` is procurement.intent.approve or procurement.po.create — the
 * people who act on a list. The buttons are absent for everyone else, and the
 * server checks again regardless.
 */

/** Same tone per state as the Needs table. */
const NEED_TONE: Record<string, StatusTone> = {
  PENDING: "pending",
  APPROVED: "info",
  ORDERED: "approved",
  REJECTED: "rejected",
  CANCELLED: "draft",
};

type NeedList = NonNullable<Awaited<ReturnType<typeof getNeedList>>>;

function PdfButton({ listId }: { listId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await exportNeedListPdf(listId);
          if ("error" in res) {
            toast.error(res.error);
            return;
          }
          // The server sends the bytes as base64 text; turn them back into a file
          const bytes = Uint8Array.from(atob(res.pdf), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = res.fileName;
          link.click();
          URL.revokeObjectURL(url);
        } finally {
          setBusy(false);
        }
      }}
    >
      <FileDown className="mr-1.5 h-4 w-4" />
      PDF
    </Button>
  );
}

export function NeedListDialog({
  list,
  canDownload,
}: {
  list: { id: string; listNumber: string };
  canDownload: boolean;
}) {
  const [data, setData] = useState<NeedList | null>(null);

  return (
    <Dialog
      onOpenChange={async (open) => {
        // Fresh each time, so the statuses are current
        if (open) setData(await getNeedList(list.id));
      }}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            className="mt-0.5 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-micro text-muted-foreground hover:bg-muted"
            title="Open the list this need belongs to"
          />
        }
      >
        <ListChecks className="h-3 w-3" />
        {list.listNumber}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{list.listNumber}</DialogTitle>
          {data && (
            <DialogDescription>
              {data.notes} · raised by {data.createdBy.name} on {formatDateTime(data.createdAt)}
            </DialogDescription>
          )}
        </DialogHeader>

        {!data ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-caption text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Quantity</th>
                    <th className="px-3 py-2 font-medium">Vendor</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.needs.map((n) => (
                    <tr key={n.id} className="border-t">
                      <td className="px-3 py-2">
                        <span className="font-mono text-xs text-muted-foreground">{n.product.code}</span> {n.product.name}
                        <span className="block font-mono text-micro text-muted-foreground">{n.intentNumber}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {n.quantity} {n.product.unit}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{n.vendor?.name ?? "—"}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={toneStyles(NEED_TONE[n.status] ?? "draft").pill}>
                          {NEED_STATUS_LABEL[n.status] ?? n.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canDownload && (
              <div className="flex justify-end gap-1.5">
                <ExportButton action={() => exportNeedListCsv(list.id)} fileName={list.listNumber} noun="item" label="CSV" />
                <PdfButton listId={list.id} />
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
