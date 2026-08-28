"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExternalLink, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getAttachmentViewUrl } from "@/lib/actions/stock";

type Attachment = {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  attachmentType: string;
};

/**
 * Opens an entry's documents straight from the list, rather than making someone
 * load the entry page first and open them from there. A single document shows
 * immediately; several give a row of tabs with the first already open.
 */
export function QuickDocsDialog({
  entryNumber,
  attachments,
  onClose,
}: {
  entryNumber: string | null;
  attachments: Attachment[];
  onClose: () => void;
}) {
  // The chosen tab is remembered against the entry it belongs to, so opening a
  // different entry falls back to its own first document without an effect.
  const [chosen, setChosen] = useState<{ entry: string; id: string } | null>(null);
  // Documents live in a PRIVATE blob store, so `fileUrl` cannot be used as a
  // src. A signed, expiring link is fetched for whichever document is on show,
  // and remembered together with the id it belongs to — so switching tabs makes
  // the previous link stop applying by itself, with nothing to clear.
  // `url: null` records an attempt that failed, which is what stops the
  // spinner from spinning for ever.
  const [signed, setSigned] = useState<{ id: string; url: string | null } | null>(null);
  const activeId =
    chosen && chosen.entry === entryNumber ? chosen.id : attachments[0]?.id ?? null;

  const forActive = signed && signed.id === activeId ? signed : null;
  const signedUrl = forActive?.url ?? null;
  const loadingUrl = !!activeId && !forActive;

  useEffect(() => {
    // Nothing is set synchronously here on purpose: every write happens once
    // the request comes back, so opening the dialog cannot cascade renders.
    if (!activeId || forActive) return;
    let cancelled = false;
    getAttachmentViewUrl(activeId).then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        toast.error(result.error);
        setSigned({ id: activeId, url: null });
      } else {
        setSigned({ id: activeId, url: result.url });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeId, forActive]);
  const setActiveId = (id: string) =>
    setChosen(entryNumber ? { entry: entryNumber, id } : null);

  const active = attachments.find((a) => a.id === activeId) ?? attachments[0] ?? null;
  const isImage = active?.mimeType.startsWith("image/") ?? false;
  const isPdf = active?.mimeType === "application/pdf";

  return (
    <Dialog open={!!entryNumber} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{entryNumber}</span>
            <span className="text-sm font-normal text-muted-foreground">
              {attachments.length} document{attachments.length === 1 ? "" : "s"}
            </span>
          </DialogTitle>
        </DialogHeader>

        {attachments.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setActiveId(a.id)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs transition",
                  a.id === active?.id
                    ? "border-brand-green bg-brand-green/10 font-medium"
                    : "hover:bg-muted/60"
                )}
              >
                {a.attachmentType}
              </button>
            ))}
          </div>
        )}

        {active && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                {active.fileName}
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={!signedUrl}
                onClick={() => {
                  if (signedUrl) window.open(signedUrl, "_blank", "noopener,noreferrer");
                }}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Open in a new tab
              </Button>
            </div>

            {loadingUrl && (
              <div className="flex h-[65vh] w-full items-center justify-center rounded-lg border">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loadingUrl && signedUrl && isImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={signedUrl}
                alt={active.fileName}
                className="max-h-[65vh] w-full rounded-lg border object-contain"
              />
            )}
            {!loadingUrl && signedUrl && isPdf && (
              <iframe
                src={signedUrl}
                title={active.fileName}
                className="h-[65vh] w-full rounded-lg border"
              />
            )}
            {!loadingUrl && !signedUrl && (
              <p className="rounded-lg border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
                This document could not be opened.
              </p>
            )}
            {signedUrl && !isImage && !isPdf && (
              <p className="rounded-lg border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
                This file type cannot be previewed here — use “Open in a new tab”.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
