import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/rbac/permissions";

/**
 * A product with a published bill of materials is MADE here, so it enters
 * stock by building it (Builds page), not by booking it in. The one exception
 * is opening stock — units that already existed before the system did — which
 * needs `stock.opening`.
 *
 * Service stock (a customer's unit in for repair) and call-back returns are
 * not new stock and never come through here.
 */
export async function directEntryRefusal(
  user: { permissions: string[] },
  productIds: string[]
): Promise<string | null> {
  if (user.permissions.includes(PERMISSIONS.STOCK_OPENING)) return null;
  const made = await prisma.product.findFirst({
    where: { id: { in: productIds }, billsOfMaterials: { some: { status: "PUBLISHED" } } },
    select: { name: true },
  });
  return made
    ? `${made.name} has a bill of materials, so it enters stock by building it on the Builds page. Booking it in directly is only for opening stock.`
    : null;
}
