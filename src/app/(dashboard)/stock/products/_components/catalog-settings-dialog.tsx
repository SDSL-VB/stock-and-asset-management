"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveCatalogSettings } from "@/lib/actions/catalog-config";
import { CATEGORY_CODE_CEILING } from "@/lib/product-codes";
import type { CatalogRules } from "@/lib/validations/product";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

/**
 * Catalog settings: the handful of rules that decide what every product form
 * insists on, and how long a category code may be.
 *
 * Shown on the Catalog page to holders of `config.catalog` only. It is a dialog
 * rather than a page because these are four answers given once and then left
 * alone — the Configuration page they used to live on is gone.
 *
 * Tightening a rule applies to what is entered from now on. Nothing already in
 * the catalog is re-checked, so shortening the code length leaves existing
 * categories with the codes they were given, exactly as a changed prefix leaves
 * existing products with theirs.
 */
export function CatalogSettingsDialog({ settings }: { settings: CatalogRules }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState(settings);

  const set = <K extends keyof CatalogRules>(key: K, next: CatalogRules[K]) =>
    setValue((all) => ({ ...all, [key]: next }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await saveCatalogSettings(value);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Catalog settings saved");
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Reopening should show what is stored, not last time's abandoned edit
        if (next) setValue(settings);
        setOpen(next);
      }}
    >
      <DialogTrigger render={<Button variant="outline" />}>
        <SlidersHorizontal className="mr-2 h-4 w-4" />
        Catalog settings
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Catalog settings</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="category-code-length">Category code length</Label>
            <Input
              id="category-code-length"
              type="number"
              min={1}
              max={CATEGORY_CODE_CEILING}
              value={value.categoryCodeLength}
              onChange={(e) => set("categoryCodeLength", Number(e.target.value))}
              className="w-24 font-mono"
              required
            />
            <p className="text-xs text-muted-foreground">
              The most characters a category code may have. A code is letters,
              numbers or both — <span className="font-mono">1001</span>,{" "}
              <span className="font-mono">ELEC</span>,{" "}
              <span className="font-mono">EL01</span> — and is always typed by
              whoever creates the category. Categories that already have a code
              keep it.
            </p>
          </div>

          <Rule
            id="require-subcategory"
            label="A product must be filed under a subcategory"
            hint="Only where the category has subcategories to choose from — a category with none is never blocked."
            checked={value.requireSubcategory}
            onChange={(v) => set("requireSubcategory", v)}
          />
          <Rule
            id="require-subcategory-code"
            label="A subcategory must carry a code"
            hint="The code becomes the middle of every product code under it: 1004-PCB-3W_CONTROL_BOARD."
            checked={value.requireSubcategoryCode}
            onChange={(v) => set("requireSubcategoryCode", v)}
          />
          <Rule
            id="require-description"
            label="A product must have a description"
            hint="The name is the handle people type; the description says what the thing actually is."
            checked={value.requireDescription}
            onChange={(v) => set("requireDescription", v)}
          />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save settings
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One switch with the sentence it turns on, and why it matters underneath. */
function Rule({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-1" />
    </div>
  );
}
