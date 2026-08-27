"use server";

/**
 * Things a person does to their OWN account.
 *
 * Called by: the change-password form at /settings/password.
 *
 * Separate from `users.ts` on purpose. Everything in that file is one person
 * administering another and is gated on a `users.*` permission; nothing here is,
 * because acting on your own account is not a capability an admin grants.
 */

import { prisma } from "@/lib/prisma";
import { requireSignedIn } from "@/lib/rbac/check";
import { changeOwnPasswordSchema } from "@/lib/validations/user";
import { encryptPassword } from "@/lib/crypto";
import { logActivity } from "./activity";
import { signOut } from "@/auth";
import bcrypt from "bcryptjs";

/**
 * Replace your own password, proving you know the current one.
 *
 * On success this does not return — it signs the person out and sends them to
 * the login page. That is deliberate: the session cookie they are holding still
 * says `mustChangePassword: true`, and `src/auth.ts` only re-reads the database
 * every thirty seconds, so without signing out the middleware would bounce them
 * straight back here for up to half a minute after they had already succeeded.
 */
export async function changeOwnPasswordAction(
  _prevState: { error?: string } | undefined,
  formData: FormData
) {
  // requireSignedIn, not requireAuth: the whole point of this action is to be
  // reachable BY someone requireAuth would redirect away.
  const user = await requireSignedIn();

  const parsed = changeOwnPasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Read the hash fresh rather than trusting anything in the session.
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { password: true, name: true },
  });
  if (!row) return { error: "Your account could not be found. Please sign in again." };

  const currentIsRight = await bcrypt.compare(parsed.data.currentPassword, row.password);
  if (!currentIsRight) {
    return { error: "That is not your current password." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: await bcrypt.hash(parsed.data.password, 12),
      // Null unless PASSWORD_ENCRYPTION_KEY is set — see src/lib/crypto.ts
      passwordEnc: encryptPassword(parsed.data.password),
      passwordSetAt: new Date(),
      passwordSetBy: row.name,
      // Only they know it now, so the forced-change gate is satisfied.
      mustChangePassword: false,
    },
  });

  await logActivity(
    "PASSWORD_CHANGED",
    "User",
    user.id,
    `${row.name} changed their own password`
  );

  // Throws a redirect, so nothing below runs.
  await signOut({ redirectTo: "/login?passwordChanged=1" });
}
