"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Link2 } from "lucide-react";

/**
 * Shown the moment someone grants a permission that cannot work alone.
 *
 * Granting "approve a bill of materials" to a role that cannot *see* one gives
 * them a capability they will never reach: the page will not open, so the grant
 * is silently worthless and the person reports it as a bug weeks later. The
 * permission list has no way of showing that on its own, so it is said here,
 * at the moment the box is ticked, with the option to fix it in one press.
 */

export type LinkedPrompt = {
  /** The permission just granted */
  key: string;
  name: string;
  /** What it also needs, and does not have */
  missing: { key: string; name: string }[];
  reason: string;
};

interface Props {
  prompt: LinkedPrompt | null;
  onGrantAll: () => void;
  onGrantAnyway: () => void;
  onCancel: () => void;
}

export function LinkedPermissionsDialog({
  prompt,
  onGrantAll,
  onGrantAnyway,
  onCancel,
}: Props) {
  if (!prompt) return null;

  const many = prompt.missing.length > 1;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Link2 className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle>
                “{prompt.name}” needs {many ? "some other permissions" : "another permission"}
              </DialogTitle>
              <DialogDescription className="mt-1">{prompt.reason}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <p className="text-caption font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Also needed
          </p>
          <ul className="space-y-1.5">
            {prompt.missing.map((m) => (
              <li key={m.key} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="font-medium">{m.name}</span>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-micro text-muted-foreground">
                  {m.key}
                </code>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-caption text-muted-foreground">
          Without {many ? "them" : "it"}, the permission is granted but unreachable — the page
          it lives on will not open.
        </p>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onGrantAnyway}>
            Just this one
          </Button>
          <Button onClick={onGrantAll}>
            Add {many ? `all ${prompt.missing.length}` : "it"} too
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
