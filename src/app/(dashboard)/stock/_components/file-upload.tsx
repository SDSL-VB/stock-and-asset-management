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

interface AttachmentTypeConfig {
  id: string;
  name: string;
  isRequired: boolean;
  allowedMimeTypes: unknown;
  maxSizeBytes: number;
}

interface Props {
  stockEntryId: string;
  attachmentTypes?: AttachmentTypeConfig[];
}

export function FileUpload({ stockEntryId, attachmentTypes }: Props) {
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
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("stockEntryId", stockEntryId);
      formData.append("attachmentType", attachmentType);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Upload failed");
        return;
      }

      toast.success("File uploaded successfully");
      setSelectedFile(null);
      setAttachmentType("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
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
