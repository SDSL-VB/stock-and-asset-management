"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Eye, FileText } from "lucide-react";

interface Attachment {
  fileName: string;
  fileUrl: string;
  mimeType: string;
}

/**
 * In-app preview for uploaded documents so nothing needs downloading:
 * images render directly, PDFs via the browser's built-in viewer.
 */
export function DocumentViewerButton({ attachment }: { attachment: Attachment }) {
  const [open, setOpen] = useState(false);

  const isImage = attachment.mimeType.startsWith("image/");
  const isPdf = attachment.mimeType === "application/pdf";
  const canPreview = isImage || isPdf;

  if (!canPreview) {
    return (
      <a href={attachment.fileUrl} target="_blank" rel="noopener noreferrer">
        <Button variant="ghost" size="sm" title="Preview not available — opens in a new tab">
          <Eye className="h-4 w-4" />
        </Button>
      </a>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        title={`View ${attachment.fileName}`}
        onClick={() => setOpen(true)}
      >
        <Eye className="h-4 w-4" />
      </Button>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <FileText className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{attachment.fileName}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 items-center justify-center overflow-auto rounded-lg border bg-muted/30">
          {isImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- local uploads with unknown dimensions
            <img
              src={attachment.fileUrl}
              alt={attachment.fileName}
              className="max-h-[70vh] w-auto max-w-full object-contain"
            />
          ) : (
            <iframe
              src={attachment.fileUrl}
              title={attachment.fileName}
              className="h-[70vh] w-full rounded-lg"
            />
          )}
        </div>

        <div className="flex justify-end">
          <a href={attachment.fileUrl} download={attachment.fileName}>
            <Button variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
