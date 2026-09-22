"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setEntryRack } from "@/lib/actions/racks";
import { rackLabel } from "@/lib/racks";

/**
 * An entry's rack on its own page: "10.3 — Rack 10, row 3", with "Change rack"
 * for whoever puts goods away or moves them (see setEntryRack for who).
 */
export function RackEditor({ entryId, rack, canChange }: { entryId: string; rack: string | null; canChange: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(rack ?? "");
  const [saving, startSaving] = useTransition();

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          placeholder="10.3"
          aria-label="Rack (rack.row)"
          className="h-8 w-28 font-mono"
        />
        <Button
          size="sm"
          disabled={saving}
          onClick={() =>
            startSaving(async () => {
              const res = await setEntryRack(entryId, value);
              if ("error" in res) {
                toast.error(res.error);
                return;
              }
              toast.success(value.trim() ? `Now on rack ${value.trim()}` : "Rack cleared");
              setEditing(false);
              router.refresh();
            })
          }
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {rack ? (
        <>
          <span className="rounded-md bg-primary px-2 py-0.5 font-mono font-bold text-primary-foreground">{rack}</span>
          <span className="text-sm">{rackLabel(rack)}</span>
        </>
      ) : (
        <span className="text-sm text-muted-foreground">Not recorded</span>
      )}
      {canChange && (
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          <MapPin className="h-4 w-4" />
          {rack ? "Change rack" : "Set rack"}
        </Button>
      )}
    </div>
  );
}
