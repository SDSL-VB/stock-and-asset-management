import { templateCsv } from "@/lib/csv-import";

/**
 * What the upload templates look like — the columns, and one filled-in row.
 *
 * Kept out of the actions themselves for two reasons. A `"use server"` file may
 * only export async functions, so a shared constant cannot live there; and the
 * dialog that offers the template download and the action that reads the file
 * back must agree about the columns, which they do by both reading this.
 *
 * The columns are the same questions the form on screen asks, in the same
 * order, so somebody who knows the form can fill the sheet without a manual.
 */

export const PRODUCT_IMPORT_COLUMNS = [
  "Category",
  "Subcategory",
  "Name",
  "Description",
  "Kind",
  "Unit",
];

const PRODUCT_IMPORT_EXAMPLE = [
  "Electrical",
  "Resistor",
  "12K Resistor",
  "12 kilo-ohm quarter watt resistor",
  "RAW",
  "pcs",
];

/** Only Category and Name must be filled in; the rest may be left blank. */
export const PRODUCT_IMPORT_REQUIRED = ["Category", "Name"];

/**
 * Other names the same columns go by — so a list exported from this app, or
 * one somebody keeps in their own wording, still reads.
 */
export const PRODUCT_IMPORT_ALIASES: Record<string, string[]> = {
  Category: ["Category Name"],
  Subcategory: ["Sub Category", "Sub-category"],
  Name: ["Item Name", "Product Name", "Product", "Item"],
  Description: ["Desc", "Details"],
  Kind: ["Type"],
  Unit: ["Measured In", "UOM", "Units"],
};

export function productImportTemplate(): string {
  return templateCsv(PRODUCT_IMPORT_COLUMNS, PRODUCT_IMPORT_EXAMPLE);
}

/**
 * Categories, and the subcategories under them: one row per subcategory, or a
 * row with the subcategory columns blank to create a category on its own.
 * Repeating the category on several rows gives it several subcategories.
 */
export const CATEGORY_IMPORT_COLUMNS = [
  "Category",
  "Category Code",
  "Subcategory",
  "Subcategory Code",
];

const CATEGORY_IMPORT_EXAMPLE = ["Electronics", "1002", "PCB", "PCB"];

/** A category needs a name; everything else depends on what is being added. */
export const CATEGORY_IMPORT_REQUIRED = ["Category"];

export const CATEGORY_IMPORT_ALIASES: Record<string, string[]> = {
  Category: ["Category Name"],
  "Category Code": ["Code Prefix", "Category Prefix", "Prefix"],
  Subcategory: ["Sub Category", "Sub-category", "Subcategory Name"],
  "Subcategory Code": ["Sub Category Code", "Sub Code", "Sub-category Code"],
};

export function categoryImportTemplate(): string {
  return templateCsv(CATEGORY_IMPORT_COLUMNS, CATEGORY_IMPORT_EXAMPLE);
}

/**
 * A delivery's lines: one row per item on the invoice. The vendor, the invoice
 * number and the site are asked once on the form itself rather than repeated on
 * every row.
 */
export const DELIVERY_IMPORT_COLUMNS = [
  "Product Code",
  "Quantity",
  "Unit Price",
  "Batch Number",
  "Rack",
  "Purchase Order",
];

const DELIVERY_IMPORT_EXAMPLE = ["1001-RESI-001", "100", "2.50", "", "10.3", "PO-0007"];

/** Only the code and the quantity must be there. */
export const DELIVERY_IMPORT_REQUIRED = ["Product Code", "Quantity"];

/**
 * The holdings report calls the code "Item Code" and the quantity "Quantity
 * Here". Somebody who downloaded that and fed it back should get a delivery
 * filled in, not a lecture about column names.
 */
export const DELIVERY_IMPORT_ALIASES: Record<string, string[]> = {
  "Product Code": ["Item Code", "Code", "Product", "Item"],
  Quantity: ["Quantity Here", "Qty", "Qty Here", "Quantity Received"],
  "Unit Price": ["Price", "Rate", "Unit Rate"],
  "Batch Number": ["Batch", "Batches", "Lot"],
  Rack: ["Rack Location", "Rack Number", "Location"],
  // Naming the order links the line to it, so the order knows it arrived
  "Purchase Order": ["PO", "PO Number", "Order", "Order Number"],
};

export function deliveryImportTemplate(): string {
  return templateCsv(DELIVERY_IMPORT_COLUMNS, DELIVERY_IMPORT_EXAMPLE);
}

/** Downloads one of the templates in the browser. */
export function downloadTemplate(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * A heading only one of the uploads has, so a file handed to the wrong one can
 * be pointed at the right one. "Category Code" only appears on a categories
 * list, "Product Code" only on a delivery, and a products list is the one with
 * a Name but neither of those.
 */
export const OTHER_IMPORTS = {
  products: [
    { heading: "Category Code", belongsTo: "categories" },
    { heading: "Product Code", belongsTo: "delivery lines" },
    { heading: "Quantity Here", belongsTo: "delivery lines" },
  ],
  categories: [
    { heading: "Product Code", belongsTo: "delivery lines" },
    { heading: "Unit Price", belongsTo: "delivery lines" },
  ],
  delivery: [
    { heading: "Category Code", belongsTo: "categories" },
    { heading: "Subcategory Code", belongsTo: "categories" },
  ],
};
