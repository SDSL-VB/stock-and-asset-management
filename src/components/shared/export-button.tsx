"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";

/**
 * Downloads whatever a server action hands back as a CSV.
 *
 * Used by: the vendor and client lists, and any other export. The action does
 * the permission check and builds the file; this only turns the returned text
 * into a download, so a page can never export something the server would not.
 *
 * Rendered only where the caller holds the matching export permission — the
 * button is absent otherwise, never disabled.
 */

type ExportResult = { csv: string; rowCount: number } | { error: string };

interface Props {
  /** The server action to call. Returns the file, or an error to show. */
  action: () => Promise<ExportResult>;
  /** Base of the downloaded file name; the date is appended */
  fileName: string;
  /** What is being counted in the success message, e.g. "vendor" */
  noun: string;
  label?: string;
}

export function ExportButton({ action, fileName, noun, label = "Export" }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    try {
      const result = await action();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${fileName}-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);

      toast.success(
        `Exported ${result.rowCount} ${noun}${result.rowCount === 1 ? "" : "s"}`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={busy}>
      {busy ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Download className="mr-2 h-4 w-4" />
      )}
      {label}
    </Button>
  );
}
