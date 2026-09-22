"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Mail } from "lucide-react";
import type { NotificationKind } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { saveMyMailSettings } from "@/lib/actions/notifications";

/**
 * My Profile → Notifications. Every notification always appears in the bell;
 * this chooses which also come by mail as they happen, and whether a summary
 * of the day comes each morning.
 */

const KINDS: { kind: NotificationKind; label: string; hint: string }[] = [
  { kind: "ACTION", label: "Waiting on me", hint: "Something to approve, verify or answer" },
  { kind: "DECIDED", label: "My things decided", hint: "Something I raised was approved, sent back, ordered…" },
  { kind: "LOW_STOCK", label: "Low stock", hint: "A watched product needs ordering (if you handle low stock)" },
  { kind: "ORDER_LATE", label: "Late orders", hint: "An order is past its due date (if you handle orders)" },
];

export function MailSettings({
  email,
  instant,
  digest,
  mailOn,
}: {
  email: string;
  instant: NotificationKind[];
  digest: boolean;
  mailOn: boolean;
}) {
  const [chosen, setChosen] = useState<NotificationKind[]>(instant);
  const [wantsDigest, setWantsDigest] = useState(digest);
  const [saving, startSaving] = useTransition();
  const changed = wantsDigest !== digest || chosen.length !== instant.length || chosen.some((k) => !instant.includes(k));

  return (
    <Card id="notifications">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" />
          Notifications by mail
        </CardTitle>
        <CardDescription>
          Everything always shows in the bell. Choose what also comes to {email}.
          {!mailOn && " Mail is not switched on for this site yet, so nothing is sent until it is."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">As it happens</p>
          {KINDS.map((k) => (
            <label key={k.kind} className="flex cursor-pointer items-start gap-3">
              <Checkbox
                className="mt-0.5"
                checked={chosen.includes(k.kind)}
                onCheckedChange={(on) =>
                  setChosen((all) => (on ? [...all, k.kind] : all.filter((x) => x !== k.kind)))
                }
              />
              <span>
                <span className="block text-sm">{k.label}</span>
                <span className="block text-xs text-muted-foreground">{k.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="flex cursor-pointer items-start gap-3">
          <Checkbox className="mt-0.5" checked={wantsDigest} onCheckedChange={(on) => setWantsDigest(on === true)} />
          <span>
            <span className="block text-sm font-medium">A summary every morning</span>
            <span className="block text-xs text-muted-foreground">One mail at 8:00 with everything from the day before</span>
          </span>
        </label>
        <Button
          disabled={saving || !changed}
          onClick={() =>
            startSaving(async () => {
              const res = await saveMyMailSettings({ instant: chosen, digest: wantsDigest });
              if ("error" in res) return void toast.error(res.error);
              toast.success("Saved");
            })
          }
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
