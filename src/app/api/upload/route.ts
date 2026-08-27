import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import path from "path";
import { writeFile, mkdir } from "fs/promises";

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

    // Save file
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const uploadDir = path.join(process.cwd(), "public", "uploads", "stock");
    await mkdir(uploadDir, { recursive: true });

    const ext = path.extname(file.name);
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filePath = path.join(uploadDir, uniqueName);

    await writeFile(filePath, buffer);

    const fileUrl = `/uploads/stock/${uniqueName}`;

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
