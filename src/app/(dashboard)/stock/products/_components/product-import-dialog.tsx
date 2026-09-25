"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  checkProductImport,
  importProducts,
  checkCategoryImport,
  importCategories,
  type ImportRowResult,
} from "@/lib/actions/product-import";
import {
  PRODUCT_IMPORT_COLUMNS,
  CATEGORY_IMPORT_COLUMNS,
  productImportTemplate,
  categoryImportTemplate,
  downloadTemplate,
} from "@/lib/import-formats";
import { toneStyles } from "@/lib/design/status";
import { cn } from "@/lib/utils";
import { Download, FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

/**
 * Adding a lot of the catalog at once, from a spreadsheet — products, or
 * categories and their subcategories.
 *
 * Three steps, in one dialog: take the template, upload the filled-in file, and
 * look at what it would do before it does it. The check and the import run the
 * same code on the server (src/lib/actions/product-import.ts), so the preview
 * is a rehearsal rather than a guess — a row that says "ready" here is a row
 * that will be added.
 *
 * Rows are independent. Twelve good rows and one typo import twelve and tell
 * you about the one, rather than refusing the file; fix that line and upload it
 * again, and the twelve already in are reported as duplicates rather than added
 * twice.
 *
 * One component serves both because the three steps and the preview table are
 * identical — only which action to call and which columns to name differ, and
 * those are the props.
 */
const KINDS = {
  products: {
    title: "Add products from a spreadsheet",
    noun: "product",
    columns: PRODUCT_IMPORT_COLUMNS,
    template: productImportTemplate,
    fileName: "product-upload-template.csv",
    check: checkProductImport,
    apply: importProducts,
    hint: "The code is not a column — each product takes the next number in its subcategory, and the subcategory's tag is added to the name.",
  },
  categories: {
    title: "Add categories from a spreadsheet",
    noun: "category",
    columns: CATEGORY_IMPORT_COLUMNS,
    template: categoryImportTemplate,
    fileName: "category-upload-template.csv",
    check: checkCategoryImport,
    apply: importCategories,
    hint: "One row per subcategory. Name the same category on several rows to give it several subcategories, or leave the subcategory columns blank to create the category alone.",
  },
} as const;

export function ProductImportDialog({ kind = "products" }: { kind?: keyof typeof KINDS }) {
  const spec = KINDS[kind];
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRowResult[] | null>(null);
  const [done, setDone] = useState(false);

  const ready = rows?.filter((r) => r.status === "ready").length ?? 0;
  const bad = rows?.filter((r) => r.status === "error").length ?? 0;

  function reset() {
    setText(null);
    setFileName("");
    setRows(null);
    setDone(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function pick(file: File) {
    setBusy(true);
    try {
      const content = await file.text();
      setText(content);
      setFileName(file.name);
      setDone(false);
      const result = await spec.check(content);
      if ("error" in result) {
        toast.error(result.error);
        setRows(null);
        return;
      }
      setRows(result.rows);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!text) return;
    setBusy(true);
    try {
      const result = await spec.apply(text);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setRows(result.rows);
      setDone(true);
      toast.success(`${result.imported} ${spec.noun}${result.imported === 1 ? "" : spec.noun === "category" ? " rows" : "s"} added`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : (setOpen(false), reset()))}>
      <DialogTrigger render={<Button variant="outline" />}>
        <FileUp className="mr-2 h-4 w-4" />
        Upload a list
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{spec.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => downloadTemplate(spec.template(), spec.fileName)}
            >
              <Download className="mr-1.5 h-4 w-4" />
              Download the template
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
              Choose a file
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv,.xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void pick(file);
              }}
            />
            {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
          </div>

          <p className="text-xs text-muted-foreground">
            Columns: {spec.columns.join(", ")}. In Excel, File → Save As → CSV. {spec.hint}
          </p>

          {rows && (
            <>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {done ? (
                  <Badge variant="outline" className={toneStyles("approved").pill}>
                    {rows.filter((r) => r.status === "imported").length} added
                  </Badge>
                ) : (
                  <Badge variant="outline" className={toneStyles("info").pill}>
                    {ready} ready
                  </Badge>
                )}
                {bad > 0 && (
                  <Badge variant="outline" className={toneStyles("rejected").pill}>
                    {bad} cannot be added
                  </Badge>
                )}
              </div>

              {/* Wide tables scroll sideways INSIDE the dialog; a phone
                  gets a list instead, because four columns of a table at
                  360px is unreadable however it is squeezed. */}
              <div className="max-h-80 overflow-y-auto rounded-md border">
                <div className="hidden overflow-x-auto sm:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">Row</TableHead>
                        <TableHead>{spec.noun === "product" ? "Product" : "Category"}</TableHead>
                        <TableHead className="w-24">Code</TableHead>
                        <TableHead>What happens</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.line} className={cn(r.status === "error" && "bg-destructive/5")}>
                          <TableCell className="text-xs text-muted-foreground tabular-nums">{r.line}</TableCell>
                          <TableCell className="font-medium">{r.name}</TableCell>
                          <TableCell className="font-mono text-xs">{r.code ?? "—"}</TableCell>
                          <TableCell
                            className={cn(
                              "text-xs whitespace-normal",
                              r.status === "error" ? "text-destructive" : "text-muted-foreground"
                            )}
                          >
                            {r.message}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <ul className="divide-y sm:hidden">
                  {rows.map((r) => (
                    <li key={r.line} className={cn("px-3 py-2", r.status === "error" && "bg-destructive/5")}>
                      <p className="flex items-baseline gap-2">
                        <span className="text-xs text-muted-foreground tabular-nums">{r.line}</span>
                        <span className="min-w-0 flex-1 break-words font-medium">{r.name}</span>
                      </p>
                      {r.code && <p className="font-mono text-xs text-muted-foreground">{r.code}</p>}
                      <p className={cn("text-xs", r.status === "error" ? "text-destructive" : "text-muted-foreground")}>
                        {r.message}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => { setOpen(false); reset(); }}>
              {done ? "Close" : "Cancel"}
            </Button>
            {!done && (
              <Button
                disabled={busy || ready === 0}
                onClick={apply}
                className="bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add {ready} {ready === 1 ? "row" : "rows"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
