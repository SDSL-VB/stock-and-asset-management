import { requireSignedIn } from "@/lib/rbac/check";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/shared/page-header";
import { PasswordChangeForm } from "./_components/password-change-form";

/**
 * Changing your own password.
 *
 * Reached two ways: from the profile page by choice, or because middleware.ts
 * sent you here and will not let you go anywhere else — that happens when an
 * admin chose your password for you (a new account, or a reset).
 *
 * Gated on being signed in and nothing more. It is deliberately NOT behind a
 * permission: an admin must not be able to take away someone's ability to stop
 * using a password that the admin knows.
 */
export default async function ChangePasswordPage() {
  // requireSignedIn, not requireAuth: requireAuth sends people here, so using
  // it on this page would be a redirect to itself.
  const user = await requireSignedIn();

  // Read the flag from the database rather than the session, because the
  // session's copy can be up to thirty seconds stale (see the jwt callback in
  // src/auth.ts) and it decides which version of this page someone sees.
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { mustChangePassword: true },
  });
  const forced = row?.mustChangePassword ?? false;

  return (
    <div className="space-y-6">
      <PageHeader
        title={forced ? "Choose your own password" : "Change password"}
        description={
          forced
            ? "Your password was set for you. Replace it with one only you know to carry on."
            : "Update the password you use to sign in."
        }
      />
      <PasswordChangeForm forced={forced} />
    </div>
  );
}
