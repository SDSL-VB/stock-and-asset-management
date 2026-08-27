"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createStockEntrySchema,
  type CreateStockEntryInput,
} from "@/lib/validations/stock";
import { createStockEntry, updateStockEntry, submitStockEntry } from "@/lib/actions/stock";
import { saveWarrantyDetails, removeWarrantyDetails } from "@/lib/actions/warranty";
import { searchProducts } from "@/lib/actions/products";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { PurchaseOrderPicker, type OpenOrderLine } from "./purchase-order-picker";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2, Save, Send, Paperclip, Search, X } from "lucide-react";
import { FileUpload } from "./file-upload";
import { RequestProductDialog } from "./request-product-dialog";
import { codePrefixOf } from "@/lib/product-codes";

interface FieldConfig {
  id: string;
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  isRequired: boolean;
  options: unknown;
  displayOrder: number;
}

interface AttachmentTypeConfig {
  id: string;
  name: string;
  isRequired: boolean;
  allowedMimeTypes: unknown;
  maxSizeBytes: number;
}

interface ProductOption {
  id: string;
  code: string;
  name: string;
  category: { id: string; name: string };
}

interface Props {
  categories: { id: string; name: string; codePrefix: string | null }[];
  locations: { id: string; name: string }[];
  clients: { id: string; name: string; city: string }[];
  vendors: { id: string; name: string }[];
  /** The creator's own site, preselected on a new entry */
  defaultLocationId?: string | null;
  fieldConfigs: FieldConfig[];
  attachmentTypes: AttachmentTypeConfig[];
  canRequestProducts?: boolean;
  canRequestCategories?: boolean;
  /** May set the batch these goods belong to */
  canSetBatch?: boolean;
  /** May record warranty and registration details */
  canEditWarranty?: boolean;
  /** Holds the direct-create permission, so the prompt says Create not Request */
  canCreateProducts?: boolean;
  canCreateCategories?: boolean;
  /** Purchase order lines still expecting goods, for booking a delivery in */
  openOrderLines?: OpenOrderLine[];
  initialData?: {
    id: string;
    productId: string | null;
    itemCode: string | null;
    itemName: string;
    supplierName: string;
    vendorId: string | null;
    quantity: number;
    unitPrice: number;
    invoiceNumber: string | null;
    locationId: string | null;
    clientId: string | null;
    batchNumber: string | null;
    warranty: {
      purchaseDate: Date;
      modelNumber: string;
      serialNumber: string;
      modelName: string | null;
      warrantyTill: Date;
      notes: string | null;
    } | null;
    clientName: string | null;
    clientLocation: string | null;
    customFields: Record<string, unknown> | null;
    status: string;
    product: { id: string; code: string; name: string; category: { id: string; name: string } } | null;
  };
}

export function StockEntryForm({ openOrderLines = [], categories, locations, clients, vendors, defaultLocationId, fieldConfigs, attachmentTypes, canRequestProducts = false, canRequestCategories = false, canSetBatch = false, canEditWarranty = false, canCreateProducts = false, canCreateCategories = false, initialData }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [savedEntryId, setSavedEntryId] = useState<string | null>(initialData?.id ?? null);
  const [autoSaving, setAutoSaving] = useState(false);

  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(
    initialData?.product ?? null
  );
  // The category fills the front half of the item code before a product is even
  // picked; selecting the product completes it.
  const [codeCategoryId, setCodeCategoryId] = useState<string>(
    initialData?.product?.category.id ?? ""
  );
  const itemCodePrefix = codePrefixOf(
    categories.find((c) => c.id === codeCategoryId)
  );

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    trigger,
    getValues,
    formState: { errors },
  } = useForm<CreateStockEntryInput>({
    resolver: zodResolver(createStockEntrySchema),
    defaultValues: initialData
      ? {
          productId: initialData.productId ?? "",
          vendorId: initialData.vendorId ?? "",
          supplierName: initialData.supplierName,
          quantity: initialData.quantity,
          unitPrice: initialData.unitPrice,
          invoiceNumber: initialData.invoiceNumber ?? "",
          locationId: initialData.locationId ?? "",
          batchNumber: initialData.batchNumber ?? "",
          clientId: initialData.clientId ?? "",
          isDirectToClient: !!(initialData.clientId ?? initialData.clientName),
          clientName: initialData.clientName ?? "",
          clientLocation: initialData.clientLocation ?? "",
          customFields: (initialData.customFields as Record<string, unknown>) ?? {},
        }
      : {
          vendorId: "",
          batchNumber: "",
          locationId: defaultLocationId ?? "",
          clientId: "",
          isDirectToClient: false,
          customFields: {},
        },
  });

  const quantity = watch("quantity");
  const unitPrice = watch("unitPrice");
  const isDirectToClient = watch("isDirectToClient");
  const clientId = watch("clientId") ?? "";
  const vendorId = watch("vendorId") ?? "";

  // Warranty is stored beside the entry, so it is kept as its own state and
  // saved once the entry itself has an id.
  const iso = (d: Date | null | undefined) =>
    d ? new Date(d).toISOString().slice(0, 10) : "";
  const [hasWarranty, setHasWarranty] = useState(!!initialData?.warranty);
  const [warranty, setWarranty] = useState({
    purchaseDate: iso(initialData?.warranty?.purchaseDate),
    modelNumber: initialData?.warranty?.modelNumber ?? "",
    serialNumber: initialData?.warranty?.serialNumber ?? "",
    modelName: initialData?.warranty?.modelName ?? "",
    warrantyTill: iso(initialData?.warranty?.warrantyTill),
    notes: initialData?.warranty?.notes ?? "",
  });

  async function persistWarranty(entryId: string) {
    if (!canEditWarranty) return;
    if (hasWarranty) {
      const result = await saveWarrantyDetails(entryId, warranty);
      if ("error" in result && result.error) toast.error(result.error);
    } else if (initialData?.warranty) {
      await removeWarrantyDetails(entryId);
    }
  }
  const totalPrice = (quantity || 0) * (unitPrice || 0);

  function handleProductSelect(product: ProductOption | null) {
    setSelectedProduct(product);
    setValue("productId", product?.id ?? "", { shouldValidate: !!product });
  }

  const [orderLine, setOrderLine] = useState<OpenOrderLine | null>(null);

  /**
   * Booking against an order fills in everything the order already knows, so
   * the operator is left confirming what turned up rather than retyping it.
   */
  function handleOrderLineSelect(line: OpenOrderLine | null) {
    setOrderLine(line);
    setValue("purchaseOrderLineId", line?.lineId ?? undefined);
    if (!line) return;
    handleProductSelect({
      id: line.productId,
      code: line.productCode,
      name: line.productName,
      category: { id: line.categoryId, name: line.categoryName },
    } as ProductOption);
    setCodeCategoryId(line.categoryId);
    setValue("vendorId", line.vendorId, { shouldValidate: true });
    setValue("locationId", line.locationId, { shouldValidate: true });
    setValue("quantity", line.outstanding, { shouldValidate: true });
  }

  // Auto-save the entry as a draft so we can upload attachments
  async function ensureEntrySaved(): Promise<string | null> {
    if (savedEntryId) return savedEntryId;

    const valid = await trigger();
    if (!valid) {
      toast.error("Please fill in all required fields before uploading");
      return null;
    }

    setAutoSaving(true);
    try {
      const data = getValues();
      const result = await createStockEntry(data);
      if ("error" in result) {
        toast.error(result.error);
        return null;
      }
      if ("entry" in result) {
        setSavedEntryId(result.entry.id);
        toast.success("Draft auto-saved");
        return result.entry.id;
      }
      return null;
    } finally {
      setAutoSaving(false);
    }
  }

  async function onSaveDraft(data: CreateStockEntryInput) {
    setSaving(true);
    try {
      const result = savedEntryId
        ? await updateStockEntry(savedEntryId, data)
        : await createStockEntry(data);

      if ("error" in result) {
        toast.error(result.error);
        return;
      }

      if (!savedEntryId && "entry" in result) {
        setSavedEntryId(result.entry.id);
      }

      const savedId = savedEntryId ?? ("entry" in result ? result.entry.id : null);
      if (savedId) await persistWarranty(savedId);
      toast.success(savedEntryId ? "Entry updated" : "Draft saved");
      router.push(`/stock/${savedEntryId ?? ("entry" in result ? result.entry.id : "")}`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function onSubmitEntry(data: CreateStockEntryInput) {
    setSubmitting(true);
    try {
      // Save first, then submit
      const saveResult = savedEntryId
        ? await updateStockEntry(savedEntryId, data)
        : await createStockEntry(data);

      if ("error" in saveResult) {
        toast.error(saveResult.error);
        return;
      }

      const entryId = savedEntryId ?? ("entry" in saveResult ? saveResult.entry.id : null);

      if (!entryId) {
        toast.error("Failed to get entry ID");
        return;
      }

      await persistWarranty(entryId);

      const submitResult = await submitStockEntry(entryId);
      if ("error" in submitResult) {
        toast.error(submitResult.error);
        return;
      }

      toast.success("Entry submitted for approval");
      router.push("/stock");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const isLoading = saving || submitting || autoSaving;

  return (
    <form className="space-y-6">
      <PurchaseOrderPicker
        lines={openOrderLines}
        selected={orderLine}
        onSelect={handleOrderLineSelect}
        disabled={isLoading || !!initialData}
      />

      <Card>
        <CardHeader>
          <CardTitle>Product</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ProductSearch
            categories={categories}
            selected={selectedProduct}
            onSelect={handleProductSelect}
            onCategoryChange={setCodeCategoryId}
          />
          {errors.productId && (
            <p className="text-sm text-destructive">{errors.productId.message}</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Item Name (from catalog)</Label>
              <div className="flex h-9 items-center rounded-md border bg-muted px-3 text-sm font-medium">
                {selectedProduct?.name ?? "Select a product above"}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Item Code (from catalog)</Label>
              <div className="flex h-9 items-center rounded-md border bg-muted px-3 font-mono text-sm font-semibold">
                {selectedProduct?.code ?? (
                  itemCodePrefix ? (
                    <>
                      {itemCodePrefix}
                      <span className="font-normal text-muted-foreground">
                        select a product
                      </span>
                    </>
                  ) : (
                    "—"
                  )
                )}
              </div>
            </div>
          </div>

          {(canRequestProducts || canRequestCategories) && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-3">
              <p className="text-xs text-muted-foreground">
                {canCreateProducts || canCreateCategories
                  ? "Product or category not in the catalog? Add it now."
                  : "Product or category not in the catalog? Send a request for an admin to add it."}
              </p>
              <RequestProductDialog
                categories={categories}
                fixedType={
                  canRequestProducts && canRequestCategories
                    ? undefined
                    : canRequestProducts
                      ? "PRODUCT"
                      : "CATEGORY"
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Entry Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Vendor *</Label>
              {vendors.length > 0 ? (
                <>
                  <Select
                    value={vendorId}
                    items={vendors.map((v) => ({ value: v.id, label: v.name }))}
                    onValueChange={(v) =>
                      setValue("vendorId", (v as string) ?? "", { shouldValidate: true })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a vendor" />
                    </SelectTrigger>
                    <SelectContent>
                      {vendors.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.vendorId && (
                    <p className="text-sm text-destructive">{errors.vendorId.message}</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No vendors have been added yet. Ask an administrator to add the
                  vendor before recording this entry.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="invoiceNumber">Invoice Number</Label>
              <Input
                id="invoiceNumber"
                {...register("invoiceNumber")}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity *</Label>
              <Input
                id="quantity"
                type="number"
                min={1}
                {...register("quantity", { valueAsNumber: true })}
                placeholder="0"
              />
              {errors.quantity && (
                <p className="text-sm text-destructive">{errors.quantity.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="unitPrice">Unit Price (INR) *</Label>
              <Input
                id="unitPrice"
                type="number"
                min={0}
                step="0.01"
                {...register("unitPrice", { valueAsNumber: true })}
                placeholder="0.00"
              />
              {errors.unitPrice && (
                <p className="text-sm text-destructive">{errors.unitPrice.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Total Price</Label>
              <div className="flex h-9 items-center rounded-md border bg-muted px-3 text-sm font-semibold">
                {new Intl.NumberFormat("en-IN", {
                  style: "currency",
                  currency: "INR",
                }).format(totalPrice)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stock Location</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {!isDirectToClient && (
            <div className="space-y-2">
              <Label>Location of Stock Received *</Label>
              {/* Controlled, not defaultValue: booking against a purchase order
                  sets this from the order, and an uncontrolled Select would
                  keep showing the placeholder while the form held the value. */}
              <Select
                value={watch("locationId") ?? ""}
                items={locations.map((loc) => ({ value: loc.id, label: loc.name }))}
                onValueChange={(value) =>
                  setValue("locationId", (value as string) ?? "", { shouldValidate: true })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.locationId && (
                <p className="text-sm text-destructive">{errors.locationId.message}</p>
              )}
            </div>
            )}
            {canSetBatch && (
              <div className="space-y-2">
                <Label htmlFor="batchNumber">Batch Number</Label>
                <Input
                  id="batchNumber"
                  {...register("batchNumber")}
                  placeholder="Supplier lot, if the goods carry one"
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Anything dispatched from this entry carries this batch, so a recall
                  can find it.
                </p>
              </div>
            )}
          </div>

          {/* Goods that ship straight from the vendor to a client still book in
              against a location, then leave again as a dispatch. */}
          <label className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              {...register("isDirectToClient")}
            />
            <span>
              <span className="block text-sm font-medium">
                Ships directly to a client
              </span>
              <span className="block text-sm text-muted-foreground">
                The goods never reach our warehouse. They still book in here and
                then leave as a dispatch to the client.
              </span>
            </span>
          </label>

          {isDirectToClient && (
            <div className="space-y-2 rounded-lg border bg-muted/40 p-4">
              <Label>Client *</Label>
              {clients.length > 0 ? (
                <>
                  <Select
                    value={clientId}
                    items={clients.map((c) => ({
                      value: c.id,
                      label: `${c.name} — ${c.city}`,
                    }))}
                    onValueChange={(v) =>
                      setValue("clientId", (v as string) ?? "", { shouldValidate: true })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a client" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} — {c.city}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.clientId && (
                    <p className="text-sm text-destructive">{errors.clientId.message}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    The client&apos;s city is what outgoing stock is filtered by.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No clients have been added yet. Ask an administrator to add the
                  client before recording this entry.
                </p>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            New stock is received into central stock. After approval, it can be moved to a
            department from the entry page.
          </p>
        </CardContent>
      </Card>

      {/* Warranty and registration — optional, and its own permission, so the
          whole card is absent for anyone who cannot record it. */}
      {canEditWarranty && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={hasWarranty}
                onChange={(e) => setHasWarranty(e.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium">
                  Include warranty and registration details
                </span>
                <span className="block text-sm text-muted-foreground">
                  For anything with a serial number and a warranty period.
                </span>
              </span>
            </label>

            {hasWarranty && (
              <div className="grid gap-4 rounded-lg border bg-muted/40 p-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="w-purchase">Date of Purchase *</Label>
                  <Input
                    id="w-purchase"
                    type="date"
                    value={warranty.purchaseDate}
                    onChange={(e) =>
                      setWarranty({ ...warranty, purchaseDate: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="w-till">Warranty Till *</Label>
                  <Input
                    id="w-till"
                    type="date"
                    value={warranty.warrantyTill}
                    onChange={(e) =>
                      setWarranty({ ...warranty, warrantyTill: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="w-model-no">Model Number *</Label>
                  <Input
                    id="w-model-no"
                    value={warranty.modelNumber}
                    onChange={(e) =>
                      setWarranty({ ...warranty, modelNumber: e.target.value })
                    }
                    placeholder="e.g. LM600-20B24"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="w-serial">Serial Number *</Label>
                  <Input
                    id="w-serial"
                    value={warranty.serialNumber}
                    onChange={(e) =>
                      setWarranty({ ...warranty, serialNumber: e.target.value })
                    }
                    className="font-mono"
                    placeholder="As printed on the unit"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="w-model-name">Model Name</Label>
                  <Input
                    id="w-model-name"
                    value={warranty.modelName}
                    onChange={(e) =>
                      setWarranty({ ...warranty, modelName: e.target.value })
                    }
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="w-notes">Notes</Label>
                  <Input
                    id="w-notes"
                    value={warranty.notes}
                    onChange={(e) => setWarranty({ ...warranty, notes: e.target.value })}
                    placeholder="Optional"
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dynamic custom fields */}
      {fieldConfigs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Additional Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {fieldConfigs.map((field) => (
                <div key={field.id} className="space-y-2">
                  <Label>
                    {field.fieldLabel}
                    {field.isRequired && " *"}
                  </Label>
                  {field.fieldType === "TEXTAREA" ? (
                    <Textarea
                      defaultValue={
                        (initialData?.customFields?.[field.fieldName] as string) ?? ""
                      }
                      onChange={(e) =>
                        setValue(`customFields.${field.fieldName}`, e.target.value)
                      }
                      placeholder={`Enter ${field.fieldLabel.toLowerCase()}`}
                    />
                  ) : field.fieldType === "SELECT" ? (
                    <Select
                      defaultValue={
                        (initialData?.customFields?.[field.fieldName] as string) ?? ""
                      }
                      onValueChange={(value) =>
                        setValue(`customFields.${field.fieldName}`, value)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={`Select ${field.fieldLabel.toLowerCase()}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.isArray(field.options) &&
                          (field.options as string[]).map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type={field.fieldType === "NUMBER" ? "number" : field.fieldType === "DATE" ? "date" : "text"}
                      defaultValue={
                        (initialData?.customFields?.[field.fieldName] as string) ?? ""
                      }
                      onChange={(e) =>
                        setValue(`customFields.${field.fieldName}`, e.target.value)
                      }
                      placeholder={`Enter ${field.fieldLabel.toLowerCase()}`}
                    />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Attachments */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Paperclip className="h-5 w-5" />
            Attachments
          </CardTitle>
        </CardHeader>
        <CardContent>
          {savedEntryId ? (
            <FileUpload
              stockEntryId={savedEntryId}
              attachmentTypes={attachmentTypes}
            />
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center space-y-3">
              <Paperclip className="h-8 w-8 text-muted-foreground/50 mx-auto" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Save entry to upload attachments
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  The entry will be saved as a draft so you can attach files
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isLoading}
                onClick={ensureEntrySaved}
              >
                {autoSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Draft & Upload
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isLoading}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isLoading}
          onClick={handleSubmit(onSaveDraft)}
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save Draft
        </Button>
        <Button
          type="button"
          disabled={isLoading}
          onClick={handleSubmit(onSubmitEntry)}
        >
          {submitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Submit for Approval
        </Button>
      </div>
    </form>
  );
}

// Category select + debounced product-name search that autofills the exact
// catalog name and code once a product is picked.
function ProductSearch({
  categories,
  selected,
  onSelect,
  onCategoryChange,
}: {
  categories: { id: string; name: string; codePrefix: string | null }[];
  selected: ProductOption | null;
  onSelect: (product: ProductOption | null) => void;
  onCategoryChange?: (categoryId: string) => void;
}) {
  const [categoryId, setCategoryId] = useState<string>(selected?.category.id ?? "");
  const [query, setQuery] = useState("");
  // A product can be set from outside — booking a delivery against a purchase
  // order fills it in — and it carries its own category. Deriving rather than
  // syncing state keeps the dropdown honest without an extra render.
  const shownCategoryId = selected?.category.id ?? categoryId;
  const [results, setResults] = useState<ProductOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close the suggestion list when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function runSearch(value: string, catId: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await searchProducts(value, catId || undefined);
        setResults(found);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label>Category *</Label>
        <Select
          value={shownCategoryId}
          items={categories.map((c) => ({ value: c.id, label: c.name }))}
          onValueChange={(value) => {
            const next = (value as string) ?? "";
            setCategoryId(next);
            onCategoryChange?.(next);
            // Changing category invalidates the current selection
            if (selected && selected.category.id !== next) {
              onSelect(null);
              setQuery("");
              setResults([]);
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2" ref={containerRef}>
        <Label htmlFor="productSearch">Search Product *</Label>
        {selected ? (
          <div className="flex h-9 items-center justify-between rounded-md border bg-brand-green/10 px-3 text-sm">
            <span className="min-w-0 truncate font-medium">
              {selected.name}{" "}
              <span className="font-mono text-muted-foreground">({selected.code})</span>
            </span>
            <button
              type="button"
              className="ml-2 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => {
                onSelect(null);
                setQuery("");
              }}
              aria-label="Clear selected product"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
            <Input
              id="productSearch"
              value={query}
              disabled={!shownCategoryId}
              onChange={(e) => {
                setQuery(e.target.value);
                runSearch(e.target.value, shownCategoryId);
              }}
              onFocus={() => {
                if (results.length > 0) setOpen(true);
              }}
              placeholder={shownCategoryId ? "Type product name..." : "Select a category first"}
              className="pl-9"
              autoComplete="off"
            />
            {open && (
              <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
                {results.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    No products found. Ask an admin to add it to the catalog.
                  </p>
                ) : (
                  <ul className="max-h-60 overflow-y-auto py-1">
                    {results.map((product) => (
                      <li key={product.id}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                          onClick={() => {
                            onSelect(product);
                            setOpen(false);
                          }}
                        >
                          <span className="min-w-0 truncate">{product.name}</span>
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {product.code}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
