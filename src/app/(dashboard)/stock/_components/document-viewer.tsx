"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Eye, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getAttachmentViewUrl } from "@/lib/actions/stock";

interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
}

/**
 * In-app preview for uploaded documents so nothing needs downloading:
 * images render directly, PDFs via the browser's built-in viewer.
 *
 * Documents live in a PRIVATE blob store, so there is no URL that can simply be
 * put in an `src`. One is asked for when the dialog opens, it is signed, and it
 * expires — which is why the link is fetched here rather than passed in as a
 * prop with the rest of the attachment.
 */
export function DocumentViewerButton({ attachment }: { attachment: Attachment }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  const isImage = attachment.mimeType.startsWith("image/");
  const isPdf = attachment.mimeType === "application/pdf";
  const canPreview = isImage || isPdf;

  /** Fetches a fresh signed link. Returns null and complains if it cannot. */
  async function fetchUrl(): Promise<string | null> {
    const result = await getAttachmentViewUrl(attachment.id);
    if ("error" in result) {
      toast.error(result.error);
      return null;
    }
    return result.url;
  }

  async function handleOpen() {
    setLoading(true);
    try {
      const fresh = await fetchUrl();
      if (!fresh) return;
      setUrl(fresh);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Opening in a new tab has to happen inside the click, or the popup blocker
   * stops it — so the tab is opened first and pointed at the link once it
   * arrives.
   */
  async function handleOpenInTab() {
    setLoading(true);
    const tab = window.open("", "_blank", "noopener,noreferrer");
    try {
      const fresh = await fetchUrl();
      if (!fresh) {
        tab?.close();
        return;
      }
      if (tab) tab.location.href = fresh;
      else window.location.href = fresh;
    } finally {
      setLoading(false);
    }
  }

  if (!canPreview) {
    return (
      <Button
        variant="ghost"
        size="sm"
        title="Preview not available — opens in a new tab"
        onClick={handleOpenInTab}
        disabled={loading}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        title={`View ${attachment.fileName}`}
        onClick={handleOpen}
        disabled={loading}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
      </Button>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <FileText className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{attachment.fileName}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 items-center justify-center overflow-auto rounded-lg border bg-muted/30">
          {url && isImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- uploads of unknown dimensions, served from blob storage
            <img
              src={url}
              alt={attachment.fileName}
              className="max-h-[70vh] w-auto max-w-full object-contain"
            />
          ) : url ? (
            <iframe
              src={url}
              title={attachment.fileName}
              className="h-[70vh] w-full rounded-lg"
            />
          ) : null}
        </div>

        <div className="flex justify-end">
          {/* A signed link already carries its own filename, and `download`
              is ignored cross-origin anyway, so this simply opens it. */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenInTab}
            disabled={loading}
          >
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
