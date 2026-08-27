"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateProcurementFlow } from "@/lib/actions/procurement";
import { toast } from "sonner";

interface Props {
  requiresApproval: boolean;
  approverRoleId: string | null;
  roles: { id: string; name: string }[];
}

/**
 * Whether a stated need has to be verified before it can be ordered.
 *
 * Worth switching off in a small team, where the person stating the need and
 * the person buying are often the same — a step that always passes is a step
 * that teaches people to click through steps.
 */
export function ProcurementFlowCard({ requiresApproval, approverRoleId, roles }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [required, setRequired] = useState(requiresApproval);
  const [roleId, setRoleId] = useState(approverRoleId ?? "");

  const dirty = required !== requiresApproval || roleId !== (approverRoleId ?? "");

  const items = [
    { value: "", label: "Anyone who can verify" },
    ...roles.map((r) => ({ value: r.id, label: r.name })),
  ];

  function save() {
    startTransition(async () => {
      const res = await updateProcurementFlow({
        requiresApproval: required,
        approverRoleId: roleId || null,
      });
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Saved");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">How buying gets approved</CardTitle>
        <p className="mt-1 text-caption text-muted-foreground">
          One rule for the whole company, covering the step between someone saying they need
          something and an order being placed for it.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="min-w-0">
            <Label htmlFor="procurement-approval" className="text-sm font-medium">
              Needs must be verified before they can be ordered
            </Label>
            <p className="mt-0.5 text-caption text-muted-foreground">
              {required
                ? "A stated need waits until someone verifies it, and only then can it go onto a purchase order."
                : "Any stated need can go straight onto an order. Nothing waits — sensible while the same few people state and buy."}
            </p>
          </div>
          <Switch
            id="procurement-approval"
            checked={required}
            onCheckedChange={(v) => setRequired(v === true)}
          />
        </div>

        {required && (
          <div className="space-y-1.5">
            <Label>Who verifies</Label>
            <Select
              value={roleId}
              items={items}
              onValueChange={(v) => setRoleId((v as string) ?? "")}
            >
              <SelectTrigger className="max-w-sm">
                <SelectValue placeholder="Anyone who can verify" />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.value || "any"} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-micro text-muted-foreground">
              Leave it open while there is no procurement team — anyone holding “Verify a Need”
              can clear the queue, including through an individual grant on their profile.
            </p>
          </div>
        )}

        <Button onClick={save} disabled={pending || !dirty}>
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
