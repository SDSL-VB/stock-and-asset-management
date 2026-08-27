// POST /api/upload — attaches one document (invoice, bill, delivery note) to a
// stock entry. Called by the attachment step of the stock-entry form.
//
// The file itself goes to Vercel Blob (object storage), NOT to the local disk.
// A serverless host gives every request a fresh, read-only filesystem, so a file
// written into `public/` would fail outright or vanish on the next deploy. Only
// the resulting public URL is stored in the database.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import path from "path";
import { put } from "@vercel/blob";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check stock.create or stock.edit permission
  const permissions = session.user.permissions ?? [];
  const hasPermission = permissions.some(
    (p) => p === "stock.create" || p === "stock.edit"
  );
  if (!hasPermission) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const stockEntryId = formData.get("stockEntryId") as string | null;
    const attachmentType = formData.get("attachmentType") as string | null;

    if (!file || !stockEntryId || !attachmentType) {
      return NextResponse.json(
        { error: "Missing required fields: file, stockEntryId, attachmentType" },
        { status: 400 }
      );
    }

    // Verify entry exists and is editable
    const entry = await prisma.stockEntry.findUnique({
      where: { id: stockEntryId },
      select: { status: true, createdById: true },
    });

    if (!entry) {
      return NextResponse.json({ error: "Stock entry not found" }, { status: 404 });
    }

    if (entry.status !== "DRAFT" && entry.status !== "REJECTED") {
      return NextResponse.json(
        { error: "Cannot upload to submitted or approved entries" },
        { status: 400 }
      );
    }

    // Validate against attachment type config
    const typeConfig = await prisma.attachmentTypeConfig.findUnique({
      where: { name: attachmentType },
    });

    if (typeConfig) {
      // Check file size
      if (file.size > typeConfig.maxSizeBytes) {
        return NextResponse.json(
          { error: `File exceeds maximum size of ${Math.round(typeConfig.maxSizeBytes / 1024 / 1024)}MB` },
          { status: 400 }
        );
      }

      // Check mime type
      if (typeConfig.allowedMimeTypes) {
        const allowed = typeConfig.allowedMimeTypes as string[];
        if (allowed.length > 0 && !allowed.includes(file.type)) {
          return NextResponse.json(
            { error: `File type ${file.type} is not allowed. Accepted: ${allowed.join(", ")}` },
            { status: 400 }
          );
        }
      }
    }

    // Upload to blob storage. addRandomSuffix lets two people both upload
    // "invoice.pdf" without one overwriting the other, while keeping the
    // original name readable in the URL.
    const ext = path.extname(file.name);
    const baseName = path.basename(file.name, ext).replace(/[^a-zA-Z0-9-_]/g, "-");
    const blob = await put(`stock/${baseName}${ext}`, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: file.type || undefined,
    });

    // An absolute https URL now, instead of a path under /public. Everywhere an
    // attachment is rendered (document-viewer, quick-docs-dialog) uses this as
    // an href or src, so those components work unchanged.
    const fileUrl = blob.url;

    // Create DB record
    const attachment = await prisma.stockEntryAttachment.create({
      data: {
        fileName: file.name,
        fileUrl,
        fileSize: file.size,
        mimeType: file.type,
        attachmentType,
        stockEntryId,
        uploadedById: session.user.id,
      },
    });

    return NextResponse.json({ success: true, attachment });
  } catch (error) {
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : "Failed to upload file";
    return NextResponse.json(
      { error: `Upload failed: ${message}` },
      { status: 500 }
    );
  }
}
