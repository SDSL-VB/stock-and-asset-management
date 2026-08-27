"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { revealUserPassword, setUserPassword } from "@/lib/actions/users";
import { toast } from "sonner";
import { Eye, EyeOff, Copy, Check, KeyRound, Loader2 } from "lucide-react";

interface PasswordMeta {
  canReveal: boolean;
  setAt: Date | null;
  setBy: string | null;
}

interface Props {
  userId: string;
  userName: string;
  meta: PasswordMeta;
  canView: boolean;
  canEdit: boolean;
}

/**
 * Credentials section of a user's profile. Rendered only when the viewer holds
 * users.password.view or users.password.edit — each half of the card appears
 * independently, so a role granted only one of the two never sees the other.
 */
export function PasswordCard({ userId, userName, meta, canView, canEdit }: Props) {
  const router = useRouter();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [copied, setCopied] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ password: "", confirmPassword: "" });

  const handleReveal = async () => {
    if (revealed) {
      setRevealed(null);
      return;
    }
    setRevealing(true);
    try {
      const result = await revealUserPassword(userId);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      setRevealed(result.password ?? null);
    } catch {
      toast.error("Something went wrong");
    } finally {
      setRevealing(false);
    }
  };

  const handleCopy = async () => {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed);
    setCopied(true);
    toast.success("Password copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await setUserPassword(userId, form);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Password updated for ${userName}`);
      setDialogOpen(false);
      setForm({ password: "", confirmPassword: "" });
      setRevealed(null);
      router.refresh();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const setAtLabel = meta.setAt
    ? new Date(meta.setAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            Password
          </CardTitle>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              Set New Password
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 min-w-48 rounded-md bg-muted p-2 font-mono text-sm break-all">
              {revealed ?? "••••••••••"}
            </p>

            {canView && meta.canReveal && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReveal}
                  disabled={revealing}
                >
                  {revealing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : revealed ? (
                    <EyeOff className="mr-2 h-4 w-4" />
                  ) : (
                    <Eye className="mr-2 h-4 w-4" />
                  )}
                  {revealed ? "Hide" : "Reveal"}
                </Button>
                {revealed && (
                  <Button variant="outline" size="sm" onClick={handleCopy}>
                    {copied ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <Copy className="mr-2 h-4 w-4" />
                    )}
                    Copy
                  </Button>
                )}
              </div>
            )}
          </div>

          {canView && !meta.canReveal && (
            <p className="text-xs text-muted-foreground">
              This password cannot be shown — it was set before password
              visibility was enabled.
              {canEdit ? " Set a new password to make it viewable." : ""}
            </p>
          )}

          {setAtLabel && (
            <p className="text-xs text-muted-foreground">
              Last set on {setAtLabel}
              {meta.setBy ? ` by ${meta.setBy}` : ""}
            </p>
          )}

          {canView && meta.canReveal && (
            <p className="text-xs text-muted-foreground">
              Revealing a password is recorded in the activity log.
            </p>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Set a new password</DialogTitle>
              <DialogDescription>
                {userName} will need to use this password the next time they
                sign in.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNew ? "text" : "password"}
                    value={form.password}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showNew ? "Hide password" : "Show password"}
                  >
                    {showNew ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  At least 8 characters, with an uppercase letter, a number and
                  a special character.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <Input
                  id="confirm-password"
                  type={showNew ? "text" : "password"}
                  value={form.confirmPassword}
                  onChange={(e) =>
                    setForm({ ...form, confirmPassword: e.target.value })
                  }
                  autoComplete="new-password"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !form.password || !form.confirmPassword}
                className="bg-brand-green hover:bg-brand-green/90 text-brand-navy"
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Update Password
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
