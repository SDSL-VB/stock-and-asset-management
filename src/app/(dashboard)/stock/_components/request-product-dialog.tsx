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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createProductRequest } from "@/lib/actions/products";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Loader2, MailQuestion } from "lucide-react";

interface Props {
  categories: {
    id: string;
    name: string;
    /** Offered as a suggestion; the reviewer decides. Absent on older callers. */
    subcategories?: { id: string; name: string; code: string | null }[];
  }[];
  /** Preselect this category for product requests (e.g. from the entry form) */
  defaultCategoryId?: string;
  /** Lock the dialog to one request type and hide the type selector */
  fixedType?: "PRODUCT" | "CATEGORY";
  /**
   * Someone who can add to the catalog themselves should not be asking
   * permission for it. When true the wording says Create, and approval is
   * skipped — the request is raised and immediately fulfilled.
   */
  canCreateDirectly?: boolean;
  /** Override the trigger button label */
  triggerLabel?: string;
}

export function RequestProductDialog({ categories, defaultCategoryId, fixedType, triggerLabel, canCreateDirectly = false }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<"PRODUCT" | "CATEGORY">(fixedType ?? "PRODUCT");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? "");
  // Both are suggestions. Whoever reviews the request is the one the catalog
  // rules are enforced against, so neither is ever required here — an operator
  // who does not know which subcategory it belongs to can still ask.
  const [subcategoryId, setSubcategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");

  const subcategories =
    categories.find((c) => c.id === categoryId)?.subcategories ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await createProductRequest({
        type,
        name: name.trim(),
        categoryId: type === "PRODUCT" ? categoryId : undefined,
        subcategoryId: type === "PRODUCT" ? subcategoryId || undefined : undefined,
        description: type === "PRODUCT" ? description.trim() || undefined : undefined,
        notes: notes.trim() || undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        type === "PRODUCT"
          ? "Product request sent — an admin will add it to the catalog"
          : "Category request sent for admin review"
      );
      setOpen(false);
      setName("");
      setNotes("");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <MailQuestion className="mr-2 h-4 w-4" />
        {triggerLabel ??
          (fixedType === "PRODUCT"
            ? canCreateDirectly
              ? "Create Product"
              : "Request Product"
            : fixedType === "CATEGORY"
              ? canCreateDirectly
                ? "Create Category"
                : "Request Category"
              : canCreateDirectly
                ? "Create Product / Category"
                : "Request Product / Category")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {fixedType === "PRODUCT"
              ? canCreateDirectly
                ? "Add a New Product"
                : "Request a New Product"
              : fixedType === "CATEGORY"
                ? canCreateDirectly
                  ? "Add a New Category"
                  : "Request a New Category"
                : canCreateDirectly
                  ? "Add a New Product or Category"
                  : "Request a New Product or Category"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Can&apos;t find what you need in the catalog? Send a request — an admin will
            review it and assign the product code.
          </p>
          {!fixedType && (
            <div className="space-y-2">
              <Label>Request Type</Label>
              <Select
                value={type}
                items={[
                  { value: "PRODUCT", label: "New Product" },
                  { value: "CATEGORY", label: "New Category" },
                ]}
                onValueChange={(v) => setType((v as "PRODUCT" | "CATEGORY") ?? "PRODUCT")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PRODUCT">New Product</SelectItem>
                  <SelectItem value="CATEGORY">New Category</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {type === "PRODUCT" && (
            <div className="space-y-2">
              <Label>Category *</Label>
              <Select
                value={categoryId}
                items={categories.map((c) => ({ value: c.id, label: c.name }))}
                onValueChange={(v) => {
                  setCategoryId(v ?? "");
                  setSubcategoryId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Category missing too? Request the category first.
              </p>
            </div>
          )}

          {type === "PRODUCT" && subcategories.length > 0 && (
            <div className="space-y-2">
              <Label>Subcategory (optional)</Label>
              <Select
                value={subcategoryId}
                items={[
                  { value: "", label: "Not sure" },
                  ...subcategories.map((sub) => ({ value: sub.id, label: sub.name })),
                ]}
                onValueChange={(v) => setSubcategoryId(v ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not sure" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Not sure</SelectItem>
                  {subcategories.map((sub) => (
                    <SelectItem key={sub.id} value={sub.id}>
                      {sub.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                A suggestion — whoever reviews this decides where it is filed.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="request-name">
              {type === "PRODUCT" ? "Product Name *" : "Category Name *"}
            </Label>
            <Input
              id="request-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                type === "PRODUCT" ? "e.g. 3W_Control_Board" : "e.g. Training Equipment"
              }
              required
            />
          </div>

          {type === "PRODUCT" && (
            <div className="space-y-2">
              <Label htmlFor="request-description">Description (optional)</Label>
              <Textarea
                id="request-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. BLDC Control board"
                rows={2}
                maxLength={300}
              />
              <p className="text-xs text-muted-foreground">
                What it actually is, in words — it helps whoever reviews this
                recognise the part.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="request-notes">Notes (optional)</Label>
            <Textarea
              id="request-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Supplier, specifications, why it's needed..."
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !name.trim() || (type === "PRODUCT" && !categoryId)}
              className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send Request
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
