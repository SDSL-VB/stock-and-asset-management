import { redirect } from "next/navigation";

/**
 * There is no list of deliveries of its own: they appear on the stock list,
 * each line tagged with its DLV- number. This address exists only because the
 * breadcrumb on a delivery page links to it.
 */
export default function DeliveriesPage() {
  redirect("/stock");
}
