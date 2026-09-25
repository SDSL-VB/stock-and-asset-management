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
import { Textarea } from "@/components/ui/textarea";
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
  createSubcategory,
  createProductRequest,
  updateSubcategory,
  toggleSubcategoryActive,
  deleteSubcategory,
} from "@/lib/actions/products";
import { SafeDeleteButton } from "@/components/shared/safe-delete-button";
import { SearchableSelect } from "@/components/shared/searchable-select";
import { ProductImportDialog } from "./product-import-dialog";
import { SuppliersDialog } from "@/components/shared/suppliers-dialog";
import {
  codeLeaderOf,
  codeSuffixOf,
  categoryCodeError,
  sequenceSuffix,
} from "@/lib/product-codes";
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
  Layers,
  Trash2,
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
import { statusPill } from "@/lib/design/status";
import type { CatalogRules } from "@/lib/validations/product";

type Subcategory = {
  id: string;
  name: string;
  /** Null means it adds nothing to a product code */
  code: string | null;
  isActive: boolean;
  /** The next product number under it — 1 means the next product is 001 */
  nextSequence: number;
  _count: { products: number };
};

type Category = {
  id: string;
  name: string;
  isActive: boolean;
  codePrefix: string | null;
  nextSequence: number;
  subcategories: Subcategory[];
  _count: { products: number };
};

type Product = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: string;
  unit: string;
  isActive: boolean;
  category: { id: string; name: string };
  subcategory: { id: string; name: string; code: string | null } | null;
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
   * What this deployment insists on, from the catalog_config table. The forms
   * use the same settings the server does, so a field the server would reject
   * is marked required here rather than failing on submit, and the category
   * code box accepts exactly what the server will.
   */
  rules?: CatalogRules;
  /** categories.request.create — asking for a subcategory from the product form */
  canRequestCategories?: boolean;
  /** vendors.edit, products.edit or stock.lowstock.manage — see suppliers.ts */
  canEditSuppliers?: boolean;
  /**
   * The request queue, as a fourth tab. Built by the page because it needs data
   * this component has no reason to know about. Null when the viewer can
   * neither ask for nor review one, and then the tab is absent entirely.
   */
  requestsTab?: {
    pending: number;
    /** Of those, the ones this viewer can approve — shown as an attention badge */
    toReview: number;
    content: React.ReactNode;
  } | null;
  /** Which tab opens first — "requests" when arriving from a review link */
  defaultTab?: "raw" | "made" | "categories" | "requests";
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
  rules = {
    requireSubcategory: false,
    requireSubcategoryCode: false,
    requireDescription: false,
    categoryCodeLength: 4,
  },
  canRequestCategories = false,
  canEditSuppliers = false,
  requestsTab = null,
  defaultTab = "raw",
}: Props) {
  // Every tab is searchable, so "where is the 12K resistor" is one box away
  // wherever you happen to be standing. Each tab keeps its own.
  const [categorySearch, setCategorySearch] = useState("");
  const shownCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.codePrefix ?? "").toLowerCase().includes(q) ||
        c.subcategories.some(
          (sub) => sub.name.toLowerCase().includes(q) || (sub.code ?? "").toLowerCase().includes(q)
        )
    );
  }, [categories, categorySearch]);

  // Split by bought or made: procured items (raw materials, ready goods) never
  // have a bill of materials; products made here always do.
  const procuredItems = useMemo(
    () => products.filter((p) => groupOf(p.kind) === "BOUGHT_IN"),
    [products]
  );
  const madeProducts = useMemo(
    () => products.filter((p) => groupOf(p.kind) === "MADE"),
    [products]
  );

  return (
    // Keyed on the tab so following a "?tab=requests" link from this page
    // switches to it — defaultValue alone is read only on first render
    <Tabs key={defaultTab} defaultValue={defaultTab}>
      <TabsList>
        <TabsTrigger value="raw">
          <Package className="mr-2 h-4 w-4" />
          {GROUP_LABEL.BOUGHT_IN} ({procuredItems.length})
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
            Requests
            {requestsTab.toReview > 0 ? (
              <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-4 text-white tabular-nums">
                {requestsTab.toReview}
              </span>
            ) : (
              requestsTab.pending > 0 && ` (${requestsTab.pending})`
            )}
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="raw" className="space-y-4">
        <ProductTable
          rules={rules}
          canEditSuppliers={canEditSuppliers}
          group="BOUGHT_IN"
          products={procuredItems}
          categories={categories}
          canCreate={canCreateProducts}
          canEdit={canEditProducts}
          canDelete={canDeleteProducts}
          canOverrideCode={canOverrideCode}
          canAddSubcategory={canCreateCategories}
          canSetSubcategoryCode={canCreateCategories}
          canRequestSubcategory={canRequestCategories}
        />
      </TabsContent>

      <TabsContent value="made" className="space-y-4">
        <ProductTable
          rules={rules}
          canEditSuppliers={canEditSuppliers}
          group="MADE"
          products={madeProducts}
          categories={categories}
          canCreate={canCreateMade}
          canEdit={canEditProducts}
          canDelete={canDeleteProducts}
          canOverrideCode={canOverrideCode}
          canAddSubcategory={canCreateCategories}
          canSetSubcategoryCode={canCreateCategories}
          canRequestSubcategory={canRequestCategories}
        />
      </TabsContent>

      <TabsContent value="categories" className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
              placeholder="Search by category, code or subcategory..."
              className="pl-9"
            />
          </div>
          {categorySearch.trim() && (
            <span className="text-sm text-muted-foreground">
              Showing {shownCategories.length} of {categories.length}
            </span>
          )}
          {canCreateCategories && <ProductImportDialog kind="categories" />}
          {canCreateCategories && (
            <CategoryDialog
              canSetSubcategoryCode={canCreateCategories}
              codeRequired={rules.requireSubcategoryCode}
              codeLength={rules.categoryCodeLength}
            />
          )}
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category Name</TableHead>
                  <TableHead>Code Prefix</TableHead>
                  <TableHead>Code Pattern</TableHead>
                  <TableHead>Subcategories</TableHead>
                  <TableHead>Products</TableHead>
                  <TableHead className="w-[160px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shownCategories.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      {categories.length === 0
                        ? "No categories yet. Add one to start building the catalog."
                        : "No category matches that."}
                    </TableCell>
                  </TableRow>
                ) : (
                  shownCategories.map((c) => (
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
                        {c.codePrefix
                          ? `${c.codePrefix}-${c.subcategories.some((sub) => sub.code) ? "[sub]-" : ""}…`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {c.subcategories.length === 0 ? (
                          <span className="text-micro text-muted-foreground">None</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {c.subcategories.map((sub) => (
                              <Badge
                                key={sub.id}
                                variant="outline"
                                className={sub.isActive ? "" : "opacity-50"}
                              >
                                {sub.name}
                                {sub.code ? ` (${sub.code})` : ""}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{c._count.products}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {(canCreateCategories || canEditCategories) && (
                            <SubcategoryDialog
                              category={c}
                              canCreate={canCreateCategories}
                              canEdit={canEditCategories}
                              canDelete={canDeleteCategories}
                              /* Choosing a code for a NEW subcategory comes
                                 with creating one; changing one already in use
                                 is the categories.prefix.edit grant. */
                              canSetCode={canCreateCategories}
                              canChangeCode={canEditPrefix}
                              codeRequired={rules.requireSubcategoryCode}
                            />
                          )}
                          {canEditPrefix && (
                            <PrefixDialog category={c} codeLength={rules.categoryCodeLength} />
                          )}
                          {canEditCategories && (
                            <CategoryDialog category={c} codeLength={rules.categoryCodeLength} />
                          )}
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
  canAddSubcategory = false,
  canSetSubcategoryCode = false,
  canRequestSubcategory = false,
  group,
  rules,
}: {
  categories: Category[];
  product?: Product;
  canOverrideCode?: boolean;
  /** categories.create — lets a missing subcategory be added from this form */
  canAddSubcategory?: boolean;
  /** categories.prefix.edit — the same grant a subcategory CODE needs anywhere */
  canSetSubcategoryCode?: boolean;
  /** categories.request.create — may ask for one they cannot add themselves */
  canRequestSubcategory?: boolean;
  /** Which tab this belongs to — decides what an Add creates */
  group: ProductGroup;
  rules: CatalogRules;
}) {
  const router = useRouter();
  const isEditing = !!product;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [categoryId, setCategoryId] = useState(product?.category.id ?? "");
  const [subcategoryId, setSubcategoryId] = useState(product?.subcategory?.id ?? "");
  // The name to open the "add a subcategory" box with — null when it is shut.
  // Searching for something that is not there offers to add it, and what was
  // typed arrives here so nobody types it twice.
  const [adding, setAdding] = useState<string | null>(null);
  const [unit, setUnit] = useState(product?.unit ?? "pcs");
  // A raw material has only one kind; a product is either finished or complete
  const [kind, setKind] = useState<ProductKind>(
    (product?.kind as ProductKind) ?? GROUP_KINDS[group][0]
  );
  const kindChoices = GROUP_KINDS[group];
  const noun = GROUP_LABEL_SINGULAR[group];

  const category = categories.find((c) => c.id === categoryId);
  // Ones added from inside this form. They are already in the database, but the
  // categories prop only catches up on the next refresh, so they are held here
  // to keep the dropdown honest the moment one is created.
  const [justAdded, setJustAdded] = useState<
    { id: string; name: string; code: string | null; nextSequence: number; categoryId: string }[]
  >([]);
  // Only what is still in use, plus whatever this product is already filed
  // under — a retired subcategory stays visible on the product that uses it, or
  // editing anything else about that product would silently move it.
  const subcategories = useMemo(() => {
    const known = category?.subcategories ?? [];
    return [
      ...known.filter((sub) => sub.isActive || sub.id === product?.subcategory?.id),
      ...justAdded.filter((sub) => sub.categoryId === categoryId && !known.some((k) => k.id === sub.id)),
    ];
  }, [category, justAdded, categoryId, product?.subcategory?.id]);

  // Subcategories that exist under OTHER categories. A subcategory belongs to
  // one category, so "Resistor" under Electrical is not the same row as
  // "Resistor" under Electronics — but it is the same word, and retyping it
  // (and its code) is how two categories end up spelling it differently. These
  // are offered as a starting point for the add box below.
  const usedElsewhere = useMemo(() => {
    const seen = new Map<string, { name: string; code: string | null }>();
    for (const c of categories) {
      if (c.id === categoryId) continue;
      for (const sub of c.subcategories) {
        if (!sub.isActive) continue;
        const key = sub.name.trim().toLowerCase();
        if (!seen.has(key)) seen.set(key, { name: sub.name, code: sub.code });
      }
    }
    // Anything this category already has is not worth offering again
    for (const sub of subcategories) seen.delete(sub.name.trim().toLowerCase());
    return [...seen.values()];
  }, [categories, categoryId, subcategories]);
  const subcategory = subcategories.find((sub) => sub.id === subcategoryId);

  // Everything to the left of the number: "1004-" or "1004-PCB-".
  const leader = codeLeaderOf(category, subcategory);
  // What the server will hand out next. Shown, not sent — the server allocates
  // it inside the transaction, so this is a preview and never the decision.
  const nextNumber = subcategory
    ? sequenceSuffix(subcategory.nextSequence)
    : category
      ? sequenceSuffix(category.nextSequence)
      : null;
  // An existing product's code only becomes editable with the override key
  const codeLocked = isEditing && !canOverrideCode;
  // Required only when the category actually has subcategories to choose from,
  // which is the same allowance the server makes.
  const subcategoryRequired = rules.requireSubcategory && subcategories.length > 0;

  // Only the last part is ever typed. It is recovered by stripping the known
  // leader rather than splitting on "-", because the typed part may contain
  // hyphens of its own (1004-PCB-3W-CONTROL).
  const [codeSuffix, setCodeSuffix] = useState(() =>
    product
      ? codeSuffixOf(
          product.code,
          codeLeaderOf(
            categories.find((c) => c.id === product.category.id),
            product.subcategory
          )
        )
      : ""
  );

  /**
   * Ask for a subcategory somebody else has to add. Raised as an ordinary
   * catalog request naming the category it belongs under, so it lands in the
   * same queue on the Requests tab as everything else people ask for.
   */
  async function requestSubcategory(wanted: string) {
    if (!wanted) return;
    const result = await createProductRequest({
      type: "CATEGORY",
      name: wanted,
      notes: `Wanted as a subcategory of ${category?.name ?? "this category"}`,
    });
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(`Asked for "${wanted}" — it will appear once somebody adds it`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        // Only an override is ever sent; blank means "give it the next number"
        codeSuffix: codeLocked || !canOverrideCode ? undefined : codeSuffix.trim() || undefined,
        name: name.trim(),
        description: description.trim() || undefined,
        categoryId,
        subcategoryId: subcategoryId || undefined,
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
        setDescription("");
        setCategoryId("");
        setSubcategoryId("");
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
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? `Edit ${product.code}` : `Add a ${noun.toLowerCase()}`}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Category and subcategory side by side: they are one question
              asked twice, and the code is built from both. Both are searched
              rather than scrolled — a real catalog outgrows a dropdown. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Category</Label>
              <SearchableSelect
                ariaLabel="Category"
                placeholder="Search categories…"
                items={categories.map((c) => ({
                  value: c.id,
                  label: c.name,
                  hint: c.codePrefix,
                  keywords: c.subcategories.map((sub) => sub.name).join(" "),
                }))}
                value={categoryId}
                onChange={(v) => {
                  setCategoryId(v);
                  // A subcategory belongs to one category, so the old choice
                  // cannot survive the category changing under it.
                  setSubcategoryId("");
                  setAdding(null);
                }}
                emptyLabel="No category matches that."
              />
            </div>

            <div className="space-y-2">
              <Label>
                Subcategory
                {!subcategoryRequired && (
                  <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
                )}
              </Label>
              {!categoryId ? (
                <p className="text-xs text-muted-foreground">Pick a category first.</p>
              ) : (
                <SearchableSelect
                  ariaLabel="Subcategory"
                  placeholder={subcategories.length === 0 ? "None yet — type to add one" : "Search subcategories…"}
                  items={[
                    ...(subcategoryRequired ? [] : [{ value: "", label: "None", hint: null }]),
                    ...subcategories.map((sub) => ({
                      value: sub.id,
                      label: sub.name,
                      hint: sub.code,
                    })),
                  ]}
                  value={subcategoryId}
                  onChange={setSubcategoryId}
                  emptyLabel={
                    subcategories.length === 0
                      ? `${category?.name} has no subcategories yet.`
                      : "No subcategory matches that."
                  }
                  emptyActions={[
                    ...(canAddSubcategory
                      ? [
                          {
                            label: (q: string) => (q ? `Add "${q}" as a subcategory` : "Add a subcategory"),
                            onSelect: (q: string) => setAdding(q),
                          },
                        ]
                      : []),
                    ...(!canAddSubcategory && canRequestSubcategory
                      ? [
                          {
                            label: (q: string) => (q ? `Ask for "${q}" to be added` : "Ask for one to be added"),
                            onSelect: (q: string) => requestSubcategory(q),
                          },
                        ]
                      : []),
                  ]}
                />
              )}

              {categoryId && subcategories.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {subcategory?.code
                    ? `Its code, ${subcategory.code}, goes into the middle of the product code.`
                    : subcategoryId
                      ? "This one adds nothing to the product code."
                      : "Filing it under one keeps the catalog searchable."}
                </p>
              )}

              {canAddSubcategory && categoryId && adding === null && (
                <Button type="button" variant="outline" size="sm" onClick={() => setAdding("")}>
                  <Plus className="mr-1 h-4 w-4" />
                  Add a subcategory
                </Button>
              )}
              {canAddSubcategory && categoryId && adding !== null && (
                <InlineSubcategoryAdd
                  key={`${categoryId}:${adding}`}
                  categoryId={categoryId}
                  categoryName={category?.name ?? ""}
                  codePrefix={category?.codePrefix ?? null}
                  canSetCode={canSetSubcategoryCode}
                  codeRequired={rules.requireSubcategoryCode}
                  usedElsewhere={usedElsewhere}
                  presetName={adding}
                  onClose={() => setAdding(null)}
                  onAdded={(sub) => {
                    setJustAdded((all) => [...all, { ...sub, nextSequence: 1, categoryId }]);
                    setSubcategoryId(sub.id);
                    setAdding(null);
                  }}
                />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="product-code">Product Code</Label>
            {codeLocked ? (
              <>
                <p className="rounded-md bg-muted p-2 font-mono text-sm">{product.code}</p>
                <p className="text-xs text-muted-foreground">
                  Codes are permanent once assigned — they appear in stock history
                  and exports.
                </p>
              </>
            ) : !canOverrideCode ? (
              <>
                {/* Given out, not typed: the next number in this subcategory */}
                <p className="rounded-md bg-muted p-2 font-mono text-sm">
                  {isEditing ? product.code : `${leader ?? "…"}${nextNumber ?? "001"}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isEditing
                    ? "The code stays as issued."
                    : categoryId
                      ? "Numbered automatically within the subcategory — 001, then 002."
                      : "Choose a category and the code fills in here."}
                </p>
              </>
            ) : (
              <>
                {/* The category's prefix is fixed and shown; only the rest is typed */}
                <div className="flex items-stretch rounded-md border focus-within:ring-2 focus-within:ring-ring">
                  <span className="flex select-none items-center rounded-l-md border-r bg-muted px-3 font-mono text-sm font-semibold text-muted-foreground">
                    {leader ?? "—"}
                  </span>
                  <Input
                    id="product-code"
                    value={codeSuffix}
                    onChange={(e) => setCodeSuffix(e.target.value.toUpperCase())}
                    placeholder={categoryId ? (nextNumber ?? "001") : "Pick a category first"}
                    className="rounded-l-none border-0 font-mono shadow-none focus-visible:ring-0"
                    disabled={!categoryId}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {codeSuffix.trim()
                    ? `The code will be ${leader ?? ""}${codeSuffix.trim()}`
                    : `Leave it blank and it becomes ${leader ?? ""}${nextNumber ?? "001"} — the next number here.`}
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
                    ) : k === "RAW" ? (
                      <Package className={"mt-0.5 h-4 w-4 shrink-0 " + (kind === k ? "text-primary" : "text-muted-foreground")} />
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="product-name">{noun} Name</Label>
              <Input
                id="product-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 3W_Control_Board"
                required
              />
              <p className="text-xs text-muted-foreground">
                The short handle people type and search for.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="product-unit">Measured in</Label>
              <Input
                id="product-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                list="product-units"
                placeholder="pcs"
              />
              <datalist id="product-units">
                {COMMON_UNITS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="product-description">
              Description
              {!rules.requireDescription && (
                <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
              )}
            </Label>
            <Textarea
              id="product-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. BLDC Control board"
              rows={2}
              maxLength={300}
              required={rules.requireDescription}
            />
            <p className="text-xs text-muted-foreground">
              What it actually is, in words — this is what tells somebody picking
              from a list that they have the right thing.
            </p>
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
                (subcategoryRequired && !subcategoryId) ||
                (rules.requireDescription && !description.trim()) ||
                false
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

/**
 * Adding a subcategory without leaving the product form.
 *
 * Somebody adding "12K Resistor" to a category that has no Resistor
 * subcategory would otherwise have to abandon the form, add it on the
 * Categories tab and start again — so in practice the product got filed under
 * the category alone. Same action and same permissions as the Subcategories
 * dialog; this is only a shorter way to reach it.
 *
 * Opened by the form — either from "Add a subcategory", or from searching the
 * picker for something that is not there, which arrives here as `presetName`.
 *
 * Subcategories already used under another category are offered as chips.
 * Pressing one fills in the name and its code, so "Resistor" means the same
 * thing and carries the same segment wherever it is used — retyping it is how
 * a catalog ends up with RESISTOR in one place and RESISTORS in another. It
 * still creates a row under THIS category: a subcategory belongs to one.
 *
 * Everything here is a button, never a nested form: this sits inside the
 * product form, and Enter is caught so it adds the subcategory rather than
 * submitting the product.
 */
function InlineSubcategoryAdd({
  categoryId,
  categoryName,
  codePrefix,
  canSetCode,
  codeRequired,
  usedElsewhere,
  presetName,
  onClose,
  onAdded,
}: {
  categoryId: string;
  categoryName: string;
  codePrefix: string | null;
  canSetCode: boolean;
  /** This catalog insists every subcategory carries a code */
  codeRequired: boolean;
  /** Distinct subcategories that exist under other categories */
  usedElsewhere: { name: string; code: string | null }[];
  /** What was searched for, so a name found missing is not typed twice */
  presetName: string;
  onClose: () => void;
  onAdded: (sub: { id: string; name: string; code: string | null }) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(presetName);
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const result = await createSubcategory({
        categoryId,
        name: name.trim(),
        code: code.trim() || undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`"${result.subcategory.name}" added under ${categoryName}`);
      onAdded(result.subcategory);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void add();
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      {usedElsewhere.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Used elsewhere in the catalog — press one to use it here:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {usedElsewhere.map((sub) => (
              <Button
                key={sub.name}
                type="button"
                variant="outline"
                size="sm"
                className="h-7"
                onClick={() => {
                  setName(sub.name);
                  if (canSetCode) setCode(sub.code ?? "");
                }}
              >
                {sub.name}
                {sub.code ? <span className="ml-1 font-mono text-xs">{sub.code}</span> : null}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onEnter}
          placeholder="e.g. Resistor"
          aria-label="New subcategory name"
        />
        {canSetCode && (
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={onEnter}
            placeholder={codeRequired ? "Code *" : "Code"}
            aria-label="New subcategory code"
            maxLength={8}
            className="w-28 font-mono"
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {canSetCode && code.trim()
          ? `Products filed here will be coded ${codePrefix ?? "????"}-${code.trim()}-…`
          : codeRequired
            ? "This catalog requires a code on every subcategory — 4 letters or so, it becomes the middle of every product code here."
            : `It goes under ${categoryName}. A code is optional — without one, products stay ${codePrefix ?? "????"}-…`}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          onClick={add}
          disabled={saving || !name.trim() || (codeRequired && !code.trim())}
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Add subcategory
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Adding or renaming a category. When adding, its subcategories can be typed in
 * the same form ("+ Add a subcategory"), each with an optional code for those
 * allowed to set one; the server creates them together with the category.
 */
function CategoryDialog({
  category,
  canSetSubcategoryCode = false,
  codeRequired = false,
  codeLength,
}: {
  category?: Category;
  canSetSubcategoryCode?: boolean;
  /** This catalog insists every subcategory carries a code */
  codeRequired?: boolean;
  /** How long a category code may be, from Catalog settings */
  codeLength: number;
}) {
  const router = useRouter();
  const isEditing = !!category;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(category?.name ?? "");
  // Only asked for when creating. Renaming leaves the code alone — changing it
  // afterwards is a separate act behind categories.prefix.edit (PrefixDialog).
  const [codePrefix, setCodePrefix] = useState("");
  const codeProblem = categoryCodeError(codePrefix, codeLength);
  const codeLooksValid = !codeProblem;
  const [subs, setSubs] = useState<{ key: number; name: string; code: string }[]>([]);
  const filledSubs = subs.filter((sub) => sub.name.trim());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = isEditing
        ? await updateProductCategory(category.id, { name: name.trim() })
        : await createProductCategory({
            name: name.trim(),
            codePrefix: codePrefix.trim(),
            subcategories: filledSubs.map((sub) => ({ name: sub.name.trim(), code: sub.code.trim() })),
          });

      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        isEditing
          ? "Category updated"
          : `Category "${name}" added${filledSubs.length ? ` with ${filledSubs.length} subcategor${filledSubs.length === 1 ? "y" : "ies"}` : ""}`
      );
      setOpen(false);
      if (!isEditing) {
        setName("");
        setCodePrefix("");
        setSubs([]);
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
      <DialogContent className="sm:max-w-xl">
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
                onChange={(e) => setCodePrefix(e.target.value.toUpperCase())}
                placeholder="e.g. 1001 or ELEC"
                maxLength={codeLength}
                required
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Letters, numbers or both, up to {codeLength} character
                {codeLength === 1 ? "" : "s"}, and not one another category
                already uses. Every product code in this category starts with
                it — <span className="font-mono">{codeLooksValid ? codePrefix.trim() : "1001"}-TV55</span>.
              </p>
              {codePrefix.trim() && codeProblem && (
                <p className="text-xs text-destructive">{codeProblem}</p>
              )}
            </div>
          )}

          {!isEditing && (
            <div className="space-y-2">
              <Label>Subcategories (optional)</Label>
              {subs.map((sub) => (
                <div key={sub.key} className="flex items-center gap-2">
                  <Input
                    value={sub.name}
                    onChange={(e) =>
                      setSubs((all) => all.map((x) => (x.key === sub.key ? { ...x, name: e.target.value } : x)))
                    }
                    placeholder="e.g. PCB"
                    aria-label="Subcategory name"
                  />
                  {canSetSubcategoryCode && (
                    <Input
                      value={sub.code}
                      onChange={(e) =>
                        setSubs((all) => all.map((x) => (x.key === sub.key ? { ...x, code: e.target.value.toUpperCase() } : x)))
                      }
                      placeholder={codeRequired ? "Code *" : "Code"}
                      aria-label="Subcategory code"
                      maxLength={8}
                      className="w-28 font-mono"
                    />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Remove this subcategory"
                    onClick={() => setSubs((all) => all.filter((x) => x.key !== sub.key))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSubs((all) => [...all, { key: Date.now(), name: "", code: "" }])}
              >
                <Plus className="h-4 w-4" />
                Add a subcategory
              </Button>
              {canSetSubcategoryCode && (
                <p className="text-xs text-muted-foreground">
                  A code is optional: it becomes the middle of the product code —{" "}
                  <span className="font-mono">{codeLooksValid ? codePrefix.trim() : "1004"}-PCB-3W_CONTROL_BOARD</span>.
                </p>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                loading ||
                !name.trim() ||
                (!isEditing && !codeLooksValid) ||
                // A catalog that requires codes cannot take a half-filled list
                (codeRequired && filledSubs.some((sub) => !sub.code.trim()))
              }
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
function PrefixDialog({ category, codeLength }: { category: Category; codeLength: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [codePrefix, setCodePrefix] = useState(category.codePrefix ?? "");
  const codeProblem = categoryCodeError(codePrefix, codeLength);

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
        <span className="text-xs">Code prefix</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Code prefix for {category.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`prefix-${category.id}`}>Code Prefix</Label>
            <Input
              id={`prefix-${category.id}`}
              value={codePrefix}
              onChange={(e) =>
                setCodePrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, codeLength))
              }
              placeholder="1001"
              className="font-mono"
              required
            />
            <p className="text-xs text-muted-foreground">
              Letters, numbers or both, up to {codeLength} character
              {codeLength === 1 ? "" : "s"}, unique across categories. New codes will look like{" "}
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
              disabled={loading || !!codeProblem}
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
  canAddSubcategory,
  canSetSubcategoryCode,
  canRequestSubcategory,
  rules,
  canEditSuppliers,
}: {
  group: ProductGroup;
  products: Product[];
  categories: Category[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canOverrideCode: boolean;
  /** Lets the product form add a missing subcategory without leaving it */
  canAddSubcategory: boolean;
  canSetSubcategoryCode: boolean;
  /** For those who cannot add one: ask for it from the same place */
  canRequestSubcategory: boolean;
  rules: CatalogRules;
  /** vendors.edit, products.edit or stock.lowstock.manage — see suppliers.ts */
  canEditSuppliers: boolean;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryFilter !== "all" && p.category.id !== categoryFilter) return false;
      if (!q) return true;
      // Matches what searchProducts() looks at, so filtering here and searching
      // on the stock entry form find the same things.
      return (
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false) ||
        (p.subcategory?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [products, search, categoryFilter]);

  const isMade = group === "MADE";
  // A kind column only earns its place where a tab mixes kinds — Procured holds
  // raw materials and ready goods; Made here holds finished products only.
  const showKind = GROUP_KINDS[group].length > 1;

  return (
    <>
      <p className="text-sm text-muted-foreground">{GROUP_HINT[group]}</p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, code, subcategory or description..."
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
          <SelectTrigger className="w-auto min-w-[200px] max-w-full">
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
        {/* Uploading a list adds products, so it sits with the Add button on
            the product tabs — not in the page header, where it would also hang
            over Categories and Requests, which it has nothing to do with. */}
        {canCreate && <ProductImportDialog />}
        {canCreate && (
          <ProductDialog
            rules={rules}
            categories={categories}
            canOverrideCode={canOverrideCode}
            canAddSubcategory={canAddSubcategory}
            canSetSubcategoryCode={canSetSubcategoryCode}
            canRequestSubcategory={canRequestSubcategory}
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
                {showKind && <TableHead>Kind</TableHead>}
                <TableHead>{isMade ? "Bill of materials" : "Entries"}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={showKind ? 7 : 6}
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
                    <TableCell className="font-medium">
                      {p.name}
                      {p.description && (
                        <span className="mt-0.5 block text-micro font-normal text-muted-foreground">
                          {p.description}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant="outline">{p.category.name}</Badge>
                        {p.subcategory && (
                          <Badge variant="outline" className="text-muted-foreground">
                            {p.subcategory.name}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    {showKind && (
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
                        className={statusPill(p.isActive ? "ACTIVE" : "INACTIVE")}
                      >
                        {p.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {/* Things we buy have suppliers, each with its own lead
                            time; things we make do not */}
                        {!isMade && (
                          <SuppliersDialog side={{ kind: "product", id: p.id, name: p.name }} canEdit={canEditSuppliers} />
                        )}
                        {canEdit && (
                          <>
                            <ProductDialog
                              rules={rules}
                              categories={categories}
                              product={p}
                              canOverrideCode={canOverrideCode}
                              canAddSubcategory={canAddSubcategory}
                              canSetSubcategoryCode={canSetSubcategoryCode}
                              canRequestSubcategory={canRequestSubcategory}
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

/**
 * Managing one category's subcategories, without leaving the Categories tab.
 *
 * A dialog rather than a page because subcategories are only ever read in the
 * context of their parent — "PCB" means nothing without "Electronics" above it,
 * and the code it contributes is only valid inside that category.
 *
 * Retiring is offered ahead of deleting, for the same reason it is everywhere
 * else in this app: a retired subcategory vanishes from the product form and
 * keeps every product already filed under it, codes and all. Deleting is
 * refused outright once anything is filed here — by the database as well as by
 * the action, so there is no way to lose a product by tidying the catalog.
 */
function SubcategoryDialog({
  category,
  canCreate,
  canEdit,
  canDelete,
  canSetCode,
  canChangeCode,
  codeRequired,
}: {
  category: Category;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Giving a NEW subcategory its code — part of categories.create */
  canSetCode: boolean;
  /** Changing the code of one that already exists — categories.prefix.edit */
  canChangeCode: boolean;
  /** This catalog insists every subcategory carries a code */
  codeRequired: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  /** Null while adding; an id while renaming an existing one */
  const [editingId, setEditingId] = useState<string | null>(null);

  function reset() {
    setEditingId(null);
    setName("");
    setCode("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = { categoryId: category.id, name: name.trim(), code: code.trim() || undefined };
      const result = editingId
        ? await updateSubcategory(editingId, payload)
        : await createSubcategory(payload);

      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(editingId ? "Subcategory updated" : `"${name.trim()}" added`);
      reset();
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(sub: Subcategory) {
    const result = await toggleSubcategoryActive(sub.id);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(result.isActive ? `"${sub.name}" restored` : `"${sub.name}" retired`);
    router.refresh();
  }

  async function handleDelete(sub: Subcategory) {
    const result = await deleteSubcategory(sub.id);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    toast.success(`"${sub.name}" deleted`);
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <Layers className="h-4 w-4" />
        <span className="text-xs">Subcategories</span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Subcategories of {category.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {category.subcategories.length === 0 ? (
            <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              None yet. A subcategory is the second level of the catalog —
              Electronics holds PCB and Resistor, and a product is filed under
              one of them.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {category.subcategories.map((sub) => (
                <li key={sub.id} className="flex items-center gap-2 p-2.5">
                  <span className="min-w-0 flex-1">
                    <span className={"text-sm font-medium " + (sub.isActive ? "" : "text-muted-foreground line-through")}>
                      {sub.name}
                    </span>
                    <span className="mt-0.5 block text-micro text-muted-foreground">
                      {sub.code
                        ? `Codes read ${category.codePrefix ?? "????"}-${sub.code}-…`
                        : "Adds nothing to the product code"}
                      {sub._count.products > 0 &&
                        ` · ${sub._count.products} product${sub._count.products === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  {canEdit && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingId(sub.id);
                          setName(sub.name);
                          setCode(sub.code ?? "");
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => handleToggle(sub)}>
                        {sub.isActive ? "Retire" : "Restore"}
                      </Button>
                    </>
                  )}
                  {/* Deleting is only ever offered for an empty one; anything
                      else is a retire, and the action refuses regardless. */}
                  {canDelete && sub._count.products === 0 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => handleDelete(sub)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {(canCreate || (canEdit && editingId)) && (
            <form onSubmit={handleSubmit} className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">
                {editingId ? "Rename subcategory" : "Add a subcategory"}
              </p>
              <div className="space-y-2">
                <Label htmlFor="sub-name">Name</Label>
                <Input
                  id="sub-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. PCB"
                  required
                />
              </div>

              {/* Choosing the code of a new subcategory comes with creating
                  one; changing an existing one's is its own grant, and is
                  refused outright once anything is filed under it. */}
              {(editingId ? canChangeCode : canSetCode) && (
                <div className="space-y-2">
                  <Label htmlFor="sub-code">
                    Code{" "}
                    {codeRequired ? (
                      <span className="text-destructive">*</span>
                    ) : (
                      <span className="font-normal text-muted-foreground">(optional)</span>
                    )}
                  </Label>
                  <Input
                    id="sub-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="PCB"
                    maxLength={8}
                    className="max-w-[160px] font-mono"
                    required={codeRequired}
                  />
                  <p className="text-xs text-muted-foreground">
                    {code
                      ? `Products here will be coded ${category.codePrefix ?? "????"}-${code}-…`
                      : codeRequired
                        ? "This catalog requires every subcategory to have a code."
                        : `Leave it blank and products here stay ${category.codePrefix ?? "????"}-… , the original format.`}
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2">
                {editingId && (
                  <Button type="button" variant="outline" onClick={reset}>
                    Cancel
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={loading || !name.trim() || (codeRequired && !editingId && !code.trim())}
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingId ? "Save" : "Add"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
