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
import { attachRefusal, typeLimits } from "@/lib/attachment-rules";

/** What the browser tells us about the upload it wants to make. */
type UploadIntent = {
  stockEntryId: string;
  attachmentType: string;
};

export async function POST(request: NextRequest) {
  try {
    // Inside the try: a body that is not JSON is a rejected request (400), not
    // a crash (500). Its own message, not the parser's, which quotes the input
    // back and says more about the internals than anyone sending it needs.
    const body = (await request.json().catch(() => {
      throw new Error("That upload request could not be read");
    })) as HandleUploadBody;

    const result = await handleUpload({
      body,
      request,

      // Runs before a token is handed out. Throwing here means no upload.
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const session = await auth();
        if (!session?.user?.id) {
          throw new Error("You are not signed in");
        }

        // Somebody still on a password an admin chose must change it first,
        // exactly as everywhere else (requireAuth)
        if (session.user.mustChangePassword) throw new Error("Change your password first");

        if (!clientPayload) throw new Error("Missing upload details");
        // The payload is whatever the browser sent. Checked for shape before any
        // of it reaches the database: two short strings, nothing else.
        const intent = JSON.parse(clientPayload) as Partial<UploadIntent>;
        if (
          typeof intent.stockEntryId !== "string" ||
          typeof intent.attachmentType !== "string" ||
          !intent.stockEntryId ||
          !intent.attachmentType ||
          intent.stockEntryId.length > 64 ||
          intent.attachmentType.length > 100
        ) {
          throw new Error("Missing upload details");
        }

        // Theirs (or they may edit any), visible to them, still editable, and a
        // known document type — the same rule the record step applies
        const refusal = await attachRefusal(session.user, intent.stockEntryId);
        if (refusal) throw new Error(refusal);
        const limits = await typeLimits(intent.attachmentType);
        if ("error" in limits) throw new Error(limits.error);

        return {
          // Must match the store's own access mode, and the client's.
          access: "private",
          addRandomSuffix: true,
          // Blob enforces these two itself and refuses the upload if the browser
          // tries to exceed them — so the limits are not merely advisory
          maximumSizeInBytes: limits.maxSizeBytes,
          allowedContentTypes: limits.allowed.length > 0 ? limits.allowed : undefined,
          // Comes back to onUploadCompleted below.
          tokenPayload: JSON.stringify({
            stockEntryId: intent.stockEntryId,
            attachmentType: intent.attachmentType,
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
