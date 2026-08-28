"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createProduct,
  updateProduct,
  toggleProductActive,
  createProductCategory,
  updateProductCategory,
  updateCategoryPrefix,
  deleteProduct,
  deleteProductCategory,
} from "@/lib/actions/products";
import { SafeDeleteButton } from "@/components/shared/safe-delete-button";
import { codePrefixOf, CODE_PREFIX_PATTERN } from "@/lib/product-codes";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Plus,
  Loader2,
  Pencil,
  Search,
  Package,
  FolderOpen,
  Hash,
  Wrench,
  Boxes,
  Inbox,
} from "lucide-react";
import {
  GROUP_LABEL,
  GROUP_LABEL_SINGULAR,
  GROUP_HINT,
  GROUP_KINDS,
  KIND_LABEL,
  KIND_HINT,
  KIND_BADGE,
  COMMON_UNITS,
  groupOf,
  labelOfKind,
  type ProductGroup,
  type ProductKind,
} from "@/lib/vocabulary";

type Category = {
  id: string;
  name: string;
  isActive: boolean;
  codePrefix: string | null;
  nextSequence: number;
  _count: { products: number };
};

type Product = {
  id: string;
  code: string;
  name: string;
  kind: string;
  unit: string;
  isActive: boolean;
  category: { id: string; name: string };
  _count: { stockEntries: number; billsOfMaterials: number };
};

interface Props {
  products: Product[];
  categories: Category[];
  canCreateProducts?: boolean;
  canEditProducts?: boolean;
  canCreateCategories?: boolean;
  canEditCategories?: boolean;
  canOverrideCode?: boolean;
  canEditPrefix?: boolean;
  canDeleteProducts?: boolean;
  canDeleteCategories?: boolean;
  /** Adding something we *make* is its own grant, separate from a raw material */
  canCreateMade?: boolean;
  /**
   * The request queue, as a fourth tab. Built by the page because it needs data
   * this component has no reason to know about. Null when the viewer can
   * neither ask for nor review one, and then the tab is absent entirely.
   */
  requestsTab?: { pending: number; content: React.ReactNode } | null;
}

export function ProductManager({
  products,
  categories,
  canCreateProducts = false,
  canEditProducts = false,
  canCreateCategories = false,
  canEditCategories = false,
  canOverrideCode = false,
  canEditPrefix = false,
  canDeleteProducts = false,
  canDeleteCategories = false,
  canCreateMade = false,
  requestsTab = null,
}: Props) {
  // Split by what a thing *is*: raw materials are bought in and consumed,
  // products are assembled here. They were one flat list doing both jobs.
  const rawMaterials = useMemo(
    () => products.filter((p) => groupOf(p.kind) === "BOUGHT_IN"),
    [products]
  );
  const madeProducts = useMemo(
    () => products.filter((p) => groupOf(p.kind) === "MADE"),
    [products]
  );

  return (
    <Tabs defaultValue="raw">
      <TabsList>
        <TabsTrigger value="raw">
          <Package className="mr-2 h-4 w-4" />
          {GROUP_LABEL.BOUGHT_IN} ({rawMaterials.length})
        </TabsTrigger>
        <TabsTrigger value="made">
          <Wrench className="mr-2 h-4 w-4" />
          {GROUP_LABEL.MADE} ({madeProducts.length})
        </TabsTrigger>
        <TabsTrigger value="categories">
          <FolderOpen className="mr-2 h-4 w-4" />
          Categories ({categories.length})
        </TabsTrigger>
        {requestsTab && (
          <TabsTrigger value="requests">
            <Inbox className="mr-2 h-4 w-4" />
            Requests{requestsTab.pending > 0 && ` (${requestsTab.pending})`}
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="raw" className="space-y-4">
        <ProductTable
          group="BOUGHT_IN"
          products={rawMaterials}
          categories={categories}
          canCreate={canCreateProducts}
          canEdit={canEditProducts}
          canDelete={canDeleteProducts}
          canOverrideCode={canOverrideCode}
        />
      </TabsContent>

      <TabsContent value="made" className="space-y-4">
        <ProductTable
          group="MADE"
          products={madeProducts}
          categories={categories}
          canCreate={canCreateMade}
          canEdit={canEditProducts}
          canDelete={canDeleteProducts}
          canOverrideCode={canOverrideCode}
        />
      </TabsContent>

      <TabsContent value="categories" className="space-y-4">
        {canCreateCategories && (
          <div className="flex justify-end">
            <CategoryDialog />
          </div>
        )}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category Name</TableHead>
                  <TableHead>Code Prefix</TableHead>
                  <TableHead>Code Pattern</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead className="w-[120px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No categories yet. Add one to start building the catalog.
                    </TableCell>
                  </TableRow>
                ) : (
                  categories.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="font-mono font-semibold">
                        {c.codePrefix ?? (
                          <span className="text-muted-foreground font-sans font-normal">
                            Not set
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground">
                        {c.codePrefix ? `${c.codePrefix}-…` : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{c._count.products}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {canEditPrefix && <PrefixDialog category={c} />}
                          {canEditCategories && <CategoryDialog category={c} />}
                          {canDeleteCategories && (
                            <SafeDeleteButton
                              compact
                              name={c.name}
                              onDelete={(o) => deleteProductCategory(c.id, o)}
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      {requestsTab && (
        <TabsContent value="requests" className="space-y-4">
          {requestsTab.content}
        </TabsContent>
      )}
    </Tabs>
  );
}

function ToggleActiveButton({ product }: { product: Product }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleToggle() {
    setLoading(true);
    try {
      const result = await toggleProductActive(product.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(product.isActive ? "Product deactivated" : "Product activated");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" disabled={loading} onClick={handleToggle}>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : product.isActive ? (
        "Deactivate"
      ) : (
        "Activate"
      )}
    </Button>
  );
}

function ProductDialog({
  categories,
  product,
  canOverrideCode = false,
  group,
}: {
  categories: Category[];
  product?: Product;
  canOverrideCode?: boolean;
  /** Which tab this belongs to — decides what an Add creates */
  group: ProductGroup;
}) {
  const router = useRouter();
  const isEditing = !!product;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(product?.name ?? "");
  const [categoryId, setCategoryId] = useState(product?.category.id ?? "");
  // Only the half after the prefix is ever typed
  const [codeSuffix, setCodeSuffix] = useState(
    product?.code.includes("-") ? product.code.split("-").slice(1).join("-") : ""
  );
  const [unit, setUnit] = useState(product?.unit ?? "pcs");
  // A raw material has only one kind; a product is either finished or complete
  const [kind, setKind] = useState<ProductKind>(
    (product?.kind as ProductKind) ?? GROUP_KINDS[group][0]
  );
  const kindChoices = GROUP_KINDS[group];
  const noun = GROUP_LABEL_SINGULAR[group];

  // The category owns the front half; it is displayed, never entered
  const prefix = codePrefixOf(categories.find((c) => c.id === categoryId));
  // An existing product's code only becomes editable with the override key
  const codeLocked = isEditing && !canOverrideCode;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        codeSuffix: codeLocked ? undefined : codeSuffix.trim(),
        name: name.trim(),
        categoryId,
        kind,
        unit: unit.trim() || "pcs",
      };
      const result = isEditing
        ? await updateProduct(product.id, payload)
        : await createProduct(payload);

      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        isEditing
          ? `${noun} updated`
          : `${noun} ${"product" in result ? result.product.code : ""} added`
      );
      setOpen(false);
      if (!isEditing) {
        setCodeSuffix("");
        setName("");
        setCategoryId("");
        setUnit("pcs");
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {isEditing ? (
        <DialogTrigger render={<Button variant="ghost" size="sm" />}>
          <Pencil className="h-4 w-4" />
        </DialogTrigger>
      ) : (
        <DialogTrigger
          render={
            <Button className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold" />
          }
        >
          <Plus className="mr-2 h-4 w-4" />
          Add {noun.toLowerCase()}
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? `Edit ${product.code}` : `Add a ${noun.toLowerCase()}`}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Category first — it supplies the front half of the code */}
          <div className="space-y-2">
            <Label>Category</Label>
            <Select
              value={categoryId}
              items={categories.map((c) => ({
                value: c.id,
                label: c.codePrefix ? `${c.name} (${c.codePrefix})` : c.name,
              }))}
              onValueChange={(v) => setCategoryId((v as string) ?? "")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
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

          <div className="space-y-2">
            <Label htmlFor="product-code">Product Code</Label>
            {codeLocked ? (
              <>
                <p className="rounded-md bg-muted p-2 font-mono text-sm">
                  {product.code}
                </p>
                <p className="text-xs text-muted-foreground">
                  Codes are permanent once assigned — they appear in stock history
                  and exports.
                </p>
              </>
            ) : (
              <>
                {/* The category's prefix is fixed and shown; only the rest is typed */}
                <div className="flex items-stretch rounded-md border focus-within:ring-2 focus-within:ring-ring">
                  <span className="flex select-none items-center rounded-l-md border-r bg-muted px-3 font-mono text-sm font-semibold text-muted-foreground">
                    {prefix ?? "—"}
                  </span>
                  <Input
                    id="product-code"
                    value={codeSuffix}
                    onChange={(e) => setCodeSuffix(e.target.value.toUpperCase())}
                    placeholder={categoryId ? "TV55" : "Pick a category first"}
                    className="rounded-l-none border-0 font-mono shadow-none focus-visible:ring-0"
                    disabled={!categoryId}
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {categoryId
                    ? `The code will be ${prefix ?? ""}${codeSuffix || "…"}`
                    : "Choose a category and its code prefix fills in here."}
                </p>
              </>
            )}
          </div>

          {kindChoices.length > 1 && (
            <div className="space-y-2">
              <Label>What is it?</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {kindChoices.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={
                      "flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors " +
                      (kind === k
                        ? "border-primary/40 bg-primary/[0.04]"
                        : "hover:bg-muted/60")
                    }
                  >
                    {k === "KIT" ? (
                      <Boxes className={"mt-0.5 h-4 w-4 shrink-0 " + (kind === k ? "text-primary" : "text-muted-foreground")} />
                    ) : (
                      <Wrench className={"mt-0.5 h-4 w-4 shrink-0 " + (kind === k ? "text-primary" : "text-muted-foreground")} />
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{KIND_LABEL[k]}</span>
                      <span className="mt-0.5 block text-micro text-muted-foreground">
                        {KIND_HINT[k]}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="product-unit">Measured in</Label>
            <Input
              id="product-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              list="product-units"
              placeholder="pcs"
              className="max-w-[200px]"
            />
            <datalist id="product-units">
              {COMMON_UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>

          <div className="space-y-2">
            <Label htmlFor="product-name">{noun} Name</Label>
            <Input
              id="product-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. English Willow Bat - Grade A"
              required
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                loading ||
                !name.trim() ||
                !categoryId ||
                (!codeLocked && !codeSuffix.trim())
              }
              className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Save Changes" : `Add ${noun.toLowerCase()}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CategoryDialog({ category }: { category?: Category }) {
  const router = useRouter();
  const isEditing = !!category;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(category?.name ?? "");
  // Only asked for when creating. Renaming leaves the code alone — changing it
  // afterwards is a separate act behind categories.prefix.edit (PrefixDialog).
  const [codePrefix, setCodePrefix] = useState("");
  const codeLooksValid = CODE_PREFIX_PATTERN.test(codePrefix.trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = isEditing
        ? await updateProductCategory(category.id, { name: name.trim() })
        : await createProductCategory({
            name: name.trim(),
            codePrefix: codePrefix.trim(),
          });

      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(isEditing ? "Category updated" : `Category "${name}" added`);
      setOpen(false);
      if (!isEditing) {
        setName("");
        setCodePrefix("");
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {isEditing ? (
        <DialogTrigger render={<Button variant="ghost" size="sm" />}>
          <Pencil className="h-4 w-4" />
        </DialogTrigger>
      ) : (
        <DialogTrigger
          render={
            <Button className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold" />
          }
        >
          <Plus className="mr-2 h-4 w-4" />
          Add Category
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? "Rename Category" : "Add Category"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="category-name">Category Name</Label>
            <Input
              id="category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cricket Equipment"
              required
            />
          </div>

          {!isEditing && (
            <div className="space-y-2">
              <Label htmlFor="category-code">Category Code</Label>
              <Input
                id="category-code"
                value={codePrefix}
                onChange={(e) => setCodePrefix(e.target.value)}
                placeholder="e.g. 1001"
                inputMode="numeric"
                maxLength={4}
                required
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Exactly 4 digits, and not one another category already uses.
                Every product code in this category starts with it —{" "}
                <span className="font-mono">
                  {codeLooksValid ? codePrefix.trim() : "1001"}-TV55
                </span>
                .
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !name.trim() || (!isEditing && !codeLooksValid)}
              className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? "Save" : "Add Category"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Changes the fixed prefix a category assigns to new product codes. Rendered
 * only for holders of categories.prefix.edit.
 */
function PrefixDialog({ category }: { category: Category }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [codePrefix, setCodePrefix] = useState(category.codePrefix ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await updateCategoryPrefix(category.id, { codePrefix: codePrefix.trim() });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${category.name} now uses prefix ${codePrefix.trim()}`);
      setOpen(false);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <Hash className="h-4 w-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Code prefix for {category.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`prefix-${category.id}`}>Code Prefix</Label>
            <Input
              id={`prefix-${category.id}`}
              value={codePrefix}
              onChange={(e) => setCodePrefix(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="1001"
              className="font-mono"
              inputMode="numeric"
              required
            />
            <p className="text-xs text-muted-foreground">
              Exactly 4 digits, unique across categories. New codes will look like{" "}
              <span className="font-mono">
                {(codePrefix || "1001")}-{String(category.nextSequence).padStart(4, "0")}
              </span>
              . The {category._count.products} product
              {category._count.products === 1 ? "" : "s"} already in this category keep
              their current codes.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || codePrefix.trim().length !== 4}
              className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Prefix
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One table, used by both group tabs.
 *
 * The two differ only in which kinds they hold and what the Add button creates,
 * so they share everything else — search, category filter, columns and row
 * actions. Writing it twice would guarantee they drifted apart.
 */
function ProductTable({
  group,
  products,
  categories,
  canCreate,
  canEdit,
  canDelete,
  canOverrideCode,
}: {
  group: ProductGroup;
  products: Product[];
  categories: Category[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canOverrideCode: boolean;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryFilter !== "all" && p.category.id !== categoryFilter) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q);
    });
  }, [products, search, categoryFilter]);

  const isMade = group === "MADE";

  return (
    <>
      <p className="text-sm text-muted-foreground">{GROUP_HINT[group]}</p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or code..."
            className="pl-9"
          />
        </div>
        <Select
          value={categoryFilter}
          items={[
            { value: "all", label: "All categories" },
            ...categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
          onValueChange={(v) => setCategoryFilter(v ?? "all")}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canCreate && (
          <ProductDialog
            categories={categories}
            canOverrideCode={canOverrideCode}
            group={group}
          />
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                {isMade && <TableHead>Kind</TableHead>}
                <TableHead>{isMade ? "Bill of materials" : "Entries"}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={isMade ? 7 : 6}
                    className="h-24 text-center text-muted-foreground"
                  >
                    {products.length === 0
                      ? `No ${GROUP_LABEL[group].toLowerCase()} yet.`
                      : "Nothing matches your search."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono font-semibold">{p.code}</TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{p.category.name}</Badge>
                    </TableCell>
                    {isMade && (
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={KIND_BADGE[p.kind as ProductKind]}
                        >
                          {labelOfKind(p.kind)}
                        </Badge>
                      </TableCell>
                    )}
                    <TableCell className="text-muted-foreground">
                      {isMade ? (
                        p._count.billsOfMaterials > 0 ? (
                          <Link
                            href={`/bom/${p.id}`}
                            className="underline-offset-2 hover:underline"
                          >
                            View
                          </Link>
                        ) : (
                          <span className="text-amber-700">Not set</span>
                        )
                      ) : (
                        p._count.stockEntries
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          p.isActive
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-gray-200 bg-gray-100 text-gray-600"
                        }
                      >
                        {p.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {canEdit && (
                          <>
                            <ProductDialog
                              categories={categories}
                              product={p}
                              canOverrideCode={canOverrideCode}
                              group={group}
                            />
                            <ToggleActiveButton product={p} />
                          </>
                        )}
                        {canDelete && (
                          <SafeDeleteButton
                            compact
                            name={`${p.code} ${p.name}`}
                            onDelete={(o) => deleteProduct(p.id, o)}
                            onDeactivate={
                              p.isActive ? () => toggleProductActive(p.id) : undefined
                            }
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
