"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { codePrefixOf } from "@/lib/product-codes";
import { KIND_HINT, KIND_LABEL, COMMON_UNITS, type ProductKind } from "@/lib/vocabulary";
import { getBomCandidates } from "@/lib/actions/bom";
import { createProduct } from "@/lib/actions/products";
import { toast } from "sonner";
import { Plus, Search, Check, Loader2, Wrench, Boxes, ArrowLeft } from "lucide-react";

type Candidate = {
  id: string;
  code: string;
  name: string;
  kind: string;
  unit: string;
  categoryName: string;
  stockEntryCount: number;
};

type Category = { id: string; name: string; codePrefix: string | null };

interface Props {
  categories: Category[];
  /** Without products.create.made the inline create path is simply absent */
  canCreateProduct: boolean;
}

/**
 * Starting a bill of materials.
 *
 * Only products are listed — a raw material is bought in and consumed, so it is
 * what goes *into* a bill of materials, never what one is for. If the product
 * does not exist yet it can be created here in one step, taking its code from
 * the category exactly as the catalog does.
 */
export function NewBomDialog({ categories, canCreateProduct }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"pick" | "create">("pick");

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Candidate | null>(null);

  // Inline create
  const [kind, setKind] = useState<ProductKind>("FINISHED");
  const [categoryId, setCategoryId] = useState("");
  const [codeSuffix, setCodeSuffix] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("pcs");

  // The category owns the front half of the code; it is shown, never typed
  const prefix = codePrefixOf(categories.find((c) => c.id === categoryId));

  async function toggle(next: boolean) {
    setOpen(next);
    if (!next) {
      setMode("pick");
      setQuery("");
      setPicked(null);
      setCategoryId("");
      setCodeSuffix("");
      setName("");
      setUnit("pcs");
      return;
    }
    setLoading(true);
    try {
      setCandidates(await getBomCandidates());
    } finally {
      setLoading(false);
    }
  }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.categoryName.toLowerCase().includes(q)
    );
  }, [candidates, query]);

  function openPicked() {
    if (!picked) return;
    toggle(false);
    router.push(`/bom/${picked.id}`);
  }

  function createAndOpen() {
    startTransition(async () => {
      const res = await createProduct({
        name,
        categoryId,
        codeSuffix,
        kind,
        unit,
      });
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      const id = res.product?.id;
      toast.success(`${res.product?.code} ${res.product?.name} created`);
      toggle(false);
      if (id) router.push(`/bom/${id}`);
      router.refresh();
    });
  }

  const createReady =
    categoryId.length > 0 && codeSuffix.trim().length > 0 && name.trim().length >= 2;

  return (
    <Dialog open={open} onOpenChange={toggle}>
      <DialogTrigger render={<Button />}>
        <Plus className="mr-1.5 h-4 w-4" />
        New bill of materials
      </DialogTrigger>

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "pick" ? "What are you making?" : "Add the product first"}
          </DialogTitle>
          <DialogDescription>
            {mode === "pick"
              ? "Pick the product this bill of materials is for. Raw materials are not listed — they are what goes into one."
              : "Its code comes from the category, the same as everywhere else. It opens straight into its bill of materials."}
          </DialogDescription>
        </DialogHeader>

        {mode === "pick" ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by product, code or category"
                className="pl-9"
                autoComplete="off"
              />
            </div>

            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-1">
              {loading ? (
                <p className="flex items-center justify-center gap-2 px-2 py-8 text-caption text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </p>
              ) : matches.length === 0 ? (
                <p className="px-2 py-8 text-center text-caption text-muted-foreground">
                  {candidates.length === 0
                    ? "Every product already has a bill of materials."
                    : "Nothing matches that search."}
                </p>
              ) : (
                matches.map((c) => {
                  const isPicked = picked?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setPicked(isPicked ? null : c)}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                        isPicked ? "bg-primary/10" : "hover:bg-muted/60"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                          isPicked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input"
                        )}
                      >
                        {isPicked && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-mono text-caption text-muted-foreground">
                            {c.code}
                          </span>
                          <span className="text-sm font-medium">{c.name}</span>
                        </span>
                        <span className="mt-0.5 block text-caption text-muted-foreground">
                          {c.categoryName} · {KIND_LABEL[c.kind as ProductKind] ?? c.kind} ·
                          measured in {c.unit}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {canCreateProduct && (
              <button
                type="button"
                onClick={() => setMode("create")}
                className="w-full rounded-lg border border-dashed px-3 py-2.5 text-left text-caption text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <span className="font-medium">Not listed?</span> Add the product here — it takes
                its code from the category, then opens its bill of materials.
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>What is it?</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <KindChoice
                  icon={Wrench}
                  kind="FINISHED"
                  selected={kind === "FINISHED"}
                  onClick={() => setKind("FINISHED")}
                />
                <KindChoice
                  icon={Boxes}
                  kind="KIT"
                  selected={kind === "KIT"}
                  onClick={() => setKind("KIT")}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={categoryId}
                items={categories.map((c) => ({ value: c.id, label: c.name }))}
                onValueChange={(v) => setCategoryId((v as string) ?? "")}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.codePrefix ? ` (${c.codePrefix})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="nb-code">Product code</Label>
                <div className="flex items-stretch">
                  <span className="inline-flex select-none items-center rounded-l-lg border border-r-0 bg-muted px-2.5 font-mono text-sm text-muted-foreground">
                    {prefix ?? "—"}
                  </span>
                  <Input
                    id="nb-code"
                    value={codeSuffix}
                    onChange={(e) => setCodeSuffix(e.target.value)}
                    placeholder="PC01"
                    className="rounded-l-none font-mono"
                    disabled={!categoryId}
                    autoComplete="off"
                  />
                </div>
                <p className="text-micro text-muted-foreground">
                  {categoryId
                    ? "The category supplies the first half; type the rest."
                    : "Pick a category first."}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nb-unit">Measured in</Label>
                <Input
                  id="nb-unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  list="nb-units"
                  placeholder="pcs"
                />
                <datalist id="nb-units">
                  {COMMON_UNITS.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nb-name">Name</Label>
              <Input
                id="nb-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Personal Computer (PC)"
                autoComplete="off"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {mode === "create" ? (
            <>
              <Button variant="ghost" onClick={() => setMode("pick")} disabled={pending}>
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                Back
              </Button>
              <Button onClick={createAndOpen} disabled={pending || !createReady}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create and start its bill of materials
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => toggle(false)} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={openPicked} disabled={pending || !picked}>
                Start its bill of materials
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KindChoice({
  icon: Icon,
  kind,
  selected,
  onClick,
}: {
  icon: typeof Wrench;
  kind: ProductKind;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
        selected ? "border-primary/40 bg-primary/[0.04]" : "hover:bg-muted/60"
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          selected ? "text-primary" : "text-muted-foreground"
        )}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{KIND_LABEL[kind]}</span>
        <span className="mt-0.5 block text-micro text-muted-foreground">{KIND_HINT[kind]}</span>
      </span>
    </button>
  );
}
