"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Upload, Loader2, FileUp } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { checkAttachmentUpload, recordStockAttachment } from "@/lib/actions/stock";
import { recordDeliveryAttachment } from "@/lib/actions/deliveries";

/**
 * The attachment picker on a stock entry.
 *
 * Uploads run in TWO steps, and the order is the point:
 *
 *   1. checkAttachmentUpload()  asks the server whether this is allowed — signed
 *                               in, holds the permission, entry still editable,
 *                               right type and size. No file is sent yet.
 *   2. upload()                 the browser sends the bytes STRAIGHT to blob
 *                               storage with the token step 1 issued.
 *   3. recordStockAttachment()  tells the server where they landed.
 *
 * The file never passes through our server, because a serverless function may
 * only receive about 4.5 MB of request body and a 10 MB invoice was being
 * rejected with a 413 before any of our code ran. See `src/app/api/upload/route.ts`,
 * which is the real gate: no token, no upload.
 *
 * On a delivery (several entries booked in together) the file is uploaded once
 * against its first line and then recorded on every line, via `deliveryId`.
 *
 * The type list is stored per deployment (attachment_type_configs), so the built-in
 * defaults here are only a fallback for a database that has none set.
 */

interface AttachmentTypeConfig {
  id: string;
  name: string;
  isRequired: boolean;
  allowedMimeTypes: unknown;
  maxSizeBytes: number;
}

interface Props {
  /** The entry the upload is checked against — a delivery's first line */
  stockEntryId: string;
  /** When set, the uploaded file is recorded on every editable line of this delivery */
  deliveryId?: string;
  attachmentTypes?: AttachmentTypeConfig[];
}

export function FileUpload({ stockEntryId, deliveryId, attachmentTypes }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [attachmentType, setAttachmentType] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Use configured types if available, otherwise fall back to defaults
  const types =
    attachmentTypes && attachmentTypes.length > 0
      ? attachmentTypes
      : [
          { id: "1", name: "Invoice", isRequired: false, allowedMimeTypes: null, maxSizeBytes: 10485760 },
          { id: "2", name: "Bill", isRequired: false, allowedMimeTypes: null, maxSizeBytes: 10485760 },
          { id: "3", name: "Delivery Note", isRequired: false, allowedMimeTypes: null, maxSizeBytes: 10485760 },
          { id: "4", name: "Other", isRequired: false, allowedMimeTypes: null, maxSizeBytes: 10485760 },
        ];

  const selectedConfig = types.find((t) => t.name === attachmentType);
  const maxSizeMB = selectedConfig
    ? Math.round(selectedConfig.maxSizeBytes / (1024 * 1024))
    : 10;

  // Build accept string from configured MIME types
  const acceptStr = selectedConfig?.allowedMimeTypes
    ? Array.isArray(selectedConfig.allowedMimeTypes)
      ? (selectedConfig.allowedMimeTypes as string[]).join(",")
      : undefined
    : undefined;

  async function handleUpload() {
    if (!selectedFile || !attachmentType) {
      toast.error("Please select a file and attachment type");
      return;
    }

    // Client-side size check
    if (selectedConfig && selectedFile.size > selectedConfig.maxSizeBytes) {
      toast.error(`File exceeds maximum size of ${maxSizeMB}MB`);
      return;
    }

    setUploading(true);
    try {
      // Ask first, in plain language. @vercel/blob discards the server's reason
      // when a token is refused and reports only "Failed to retrieve the client
      // token", so without this step every refusal reads the same.
      const check = await checkAttachmentUpload({
        stockEntryId,
        attachmentType,
        fileSize: selectedFile.size,
        mimeType: selectedFile.type,
      });
      if ("error" in check) {
        toast.error(check.error);
        return;
      }

      // The file goes straight from this browser to Blob storage. It does NOT
      // pass through our server: a serverless function can only receive about
      // 4.5 MB, and anything larger was rejected with a 413 before our code ran.
      // /api/upload is asked only for permission, and answers with a token.
      const blob = await upload(selectedFile.name, selectedFile, {
        // PRIVATE, not public. Invoices carry vendor names, amounts and GST
        // numbers, so a URL that anybody could fetch forever is the wrong
        // trade. Reading one goes through getAttachmentViewUrl instead, which
        // signs a link that expires. The store itself is private, and asking it
        // for public access is refused with a 400 the browser can only describe
        // as a CORS error.
        access: "private",
        handleUploadUrl: "/api/upload",
        clientPayload: JSON.stringify({ stockEntryId, attachmentType }),
      });

      // Only now does the database learn about it. The action re-checks the
      // permission and the entry's status, because everything it is being told
      // here came from the browser.
      const file = {
        attachmentType,
        fileName: selectedFile.name,
        fileUrl: blob.url,
        fileSize: selectedFile.size,
        mimeType: selectedFile.type,
      };
      const result = deliveryId
        ? await recordDeliveryAttachment({ deliveryId, ...file })
        : await recordStockAttachment({ stockEntryId, ...file });

      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      toast.success("File uploaded successfully");
      setSelectedFile(null);
      setAttachmentType("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } catch (error) {
      // upload() throws on a refused token or a failed transfer. Show what it
      // said — the old code called res.json() before checking res.ok, so a
      // plain-text platform error surfaced as "Unexpected token 'R'" instead.
      toast.error(
        error instanceof Error ? error.message : "Upload failed. Please try again."
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rounded-lg border border-dashed p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <FileUp className="h-4 w-4" />
        Upload Attachment
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Select value={attachmentType} onValueChange={(v) => setAttachmentType(v ?? "")}>
            <SelectTrigger>
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              {types.map((type) => (
                <SelectItem key={type.id} value={type.name}>
                  <span className="flex items-center gap-2">
                    {type.name}
                    {type.isRequired && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 text-amber-600 border-amber-200">
                        Required
                      </Badge>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm cursor-pointer file:border-0 file:bg-transparent file:text-sm file:font-medium"
            accept={acceptStr || ".pdf,.jpg,.jpeg,.png"}
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <Button
          onClick={handleUpload}
          disabled={uploading || !selectedFile || !attachmentType}
          size="sm"
          className="h-9"
        >
          {uploading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          Upload
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {selectedConfig
          ? `Max ${maxSizeMB}MB`
          : "Select attachment type first"}
        {" · "}Accepted: PDF, JPG, PNG
      </p>
    </div>
  );
}
