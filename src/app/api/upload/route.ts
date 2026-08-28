// POST /api/upload — issues a short-lived token that lets the browser upload one
// document straight to Blob storage. Called by the attachment step of the
// stock-entry form (stock/_components/file-upload.tsx).
//
// The file itself NEVER passes through this function. That is the whole point:
// a serverless function may only receive a request body of about 4.5 MB, so
// posting a 10 MB invoice through it was rejected by the platform with a 413
// before any of our own code ran. The browser now sends the bytes directly to
// Blob storage, and this route only decides whether it is allowed to.
//
// Which means this file IS the gate. Everything checked here — signed in, holds
// the permission, entry still editable, correct file type and size — is enforced
// by refusing to issue a token. Without a token there is no upload.
import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/** What the browser tells us about the upload it wants to make. */
type UploadIntent = {
  stockEntryId: string;
  attachmentType: string;
};

export async function POST(request: NextRequest) {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request,

      // Runs before a token is handed out. Throwing here means no upload.
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const session = await auth();
        if (!session?.user?.id) {
          throw new Error("You are not signed in");
        }

        const permissions = session.user.permissions ?? [];
        const canUpload = permissions.some(
          (p) => p === "stock.create" || p === "stock.edit"
        );
        if (!canUpload) {
          throw new Error("You do not have permission to add attachments");
        }

        if (!clientPayload) throw new Error("Missing upload details");
        const intent = JSON.parse(clientPayload) as UploadIntent;
        if (!intent.stockEntryId || !intent.attachmentType) {
          throw new Error("Missing upload details");
        }

        const entry = await prisma.stockEntry.findUnique({
          where: { id: intent.stockEntryId },
          select: { status: true },
        });
        if (!entry) throw new Error("Stock entry not found");
        if (entry.status !== "DRAFT" && entry.status !== "REJECTED") {
          throw new Error("Cannot upload to submitted or approved entries");
        }

        const typeConfig = await prisma.attachmentTypeConfig.findUnique({
          where: { name: intent.attachmentType },
        });

        // Blob enforces these two for us, and rejects the upload itself if the
        // browser tries to exceed them — so the limits are not merely advisory.
        const allowed = Array.isArray(typeConfig?.allowedMimeTypes)
          ? (typeConfig.allowedMimeTypes as string[])
          : [];

        return {
          addRandomSuffix: true,
          maximumSizeInBytes: typeConfig?.maxSizeBytes,
          allowedContentTypes: allowed.length > 0 ? allowed : undefined,
          // Comes back to onUploadCompleted below.
          tokenPayload: JSON.stringify({
            ...intent,
            uploadedById: session.user.id,
          }),
        };
      },

      // Blob calls this from ITS servers once the file has landed. It cannot
      // reach a machine running on localhost, so the database row is written by
      // recordStockAttachment (src/lib/actions/stock.ts) once the browser sees
      // the upload finish. That works in development and in production alike;
      // this hook stays as the place to add anything that must happen even if
      // the browser closes mid-upload.
      onUploadCompleted: async () => {
        // Intentionally empty — see the comment above.
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not start the upload";
    // 400 rather than 500: every throw above is a rejected request, not a fault.
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
