"use client";

import { useActionState } from "react";
import Link from "next/link";
import { changeOwnPasswordAction } from "@/lib/actions/account";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, KeyRound, Loader2, ShieldAlert } from "lucide-react";

/**
 * The form itself. `forced` is true when middleware sent the person here and
 * is blocking every other page — in that case there is no way out of the form,
 * so the Cancel link is not rendered.
 */
export function PasswordChangeForm({ forced }: { forced: boolean }) {
  const [state, formAction, isPending] = useActionState(
    changeOwnPasswordAction,
    undefined
  );

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-brand-green" />
          {forced ? "Set a new password" : "Change password"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {forced && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-body text-amber-700 dark:text-amber-400">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Whoever set this password for you knows it. Until you replace it,
              you cannot reach the rest of the system.
            </span>
          </div>
        )}

        <form action={formAction} className="space-y-4">
          {state?.error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-body text-destructive"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{state.error}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              autoFocus
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              disabled={isPending}
            />
            <p className="text-caption text-muted-foreground">
              At least 8 characters, with an uppercase letter, a number and a
              special character.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              autoComplete="new-password"
              disabled={isPending}
            />
          </div>

          <p className="text-caption text-muted-foreground">
            You will be signed out afterwards and asked to sign in with the new
            password.
          </p>

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="animate-spin" />
                  Saving...
                </>
              ) : (
                "Change password"
              )}
            </Button>
            {/* No way out while the change is being forced. */}
            {!forced && (
              <Button
                render={<Link href="/settings/profile" />}
                nativeButton={false}
                variant="ghost"
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
