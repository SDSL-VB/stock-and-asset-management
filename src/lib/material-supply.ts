import { prisma } from "@/lib/prisma";
import { availabilityInclude, availableQuantity, round } from "@/lib/stock-availability";
import { lockEntries } from "@/lib/stock-locks";
import { nextReference } from "@/lib/reference-numbers";

/**
 * Supplying a material request: move central stock into the department, oldest
 * first, for every line — as much as there is. Called by actions/materials.ts
 * once it has checked who may supply; kept here, outside the server actions,
 * because it is plain logic with no session of its own.
 *
 * The request is claimed first, so two people supplying at once cannot both
 * move its stock, and the entries are locked while counted. Materials are
 * stock: anything the Stock Manager classified as an asset stays put, and so
 * does service stock.
 *
 * Returns the status it ended in — SUPPLIED or PARTLY_SUPPLIED — or null when
 * the request was no longer waiting to be supplied.
 */
export async function supplyFromCentral(
  requestId: string,
  userId: string
): Promise<"SUPPLIED" | "PARTLY_SUPPLIED" | null> {
  return prisma.$transaction(async (tx) => {
    const request = await tx.materialRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { lines: true },
    });
    const claimed = await tx.materialRequest.updateMany({
      where: { id: requestId, status: "PENDING_STOCK" },
      data: { status: "SUPPLIED", suppliedById: userId, suppliedAt: new Date() },
    });
    if (claimed.count !== 1) return null;

    const where = {
      productId: { in: request.lines.map((l) => l.productId) },
      status: "APPROVED" as const,
      departmentId: null,
      forService: false,
      isAsset: false,
      locationId: request.locationId,
    };
    const candidates = await tx.stockEntry.findMany({ where, select: { id: true } });
    await lockEntries(tx, candidates.map((c) => c.id));

    let short = false;
    for (const line of request.lines) {
      let remaining = round(line.quantity - line.supplied);
      const entries = await tx.stockEntry.findMany({
        where: { ...where, productId: line.productId },
        include: availabilityInclude,
        orderBy: { createdAt: "asc" },
      });
      let moved = 0;
      for (const entry of entries) {
        if (remaining <= 0) break;
        const take = round(Math.min(availableQuantity(entry), remaining));
        if (take <= 0) continue;
        await tx.stockIssue.create({
          data: {
            issueNumber: await nextReference("SI", tx),
            stockEntryId: entry.id,
            departmentId: request.departmentId,
            quantity: take,
            isAsset: false,
            notes: `Supplied on ${request.requestNumber}`,
            issuedById: userId,
          },
        });
        moved = round(moved + take);
        remaining = round(remaining - take);
      }
      if (moved > 0) {
        await tx.materialRequestLine.update({ where: { id: line.id }, data: { supplied: round(line.supplied + moved) } });
      }
      if (remaining > 0) short = true;
    }
    if (short) {
      await tx.materialRequest.update({ where: { id: requestId }, data: { status: "PARTLY_SUPPLIED" } });
      return "PARTLY_SUPPLIED";
    }
    return "SUPPLIED";
  });
}
