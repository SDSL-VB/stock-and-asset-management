"use server";

import { prisma } from "@/lib/prisma";
import { requirePermission, requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { clientSchema } from "@/lib/validations/client";
import { toCsv } from "@/lib/csv";
import { archive } from "@/lib/recycle-bin";
import { logActivity } from "./activity";
import { revalidatePath } from "next/cache";

const CLIENT_MANAGE_PERMISSIONS = [
  PERMISSIONS.CLIENTS_VIEW,
  PERMISSIONS.CLIENTS_CREATE,
  PERMISSIONS.CLIENTS_EDIT,
];

export async function getClients() {
  await requireAnyPermission(CLIENT_MANAGE_PERMISSIONS);

  return prisma.client.findMany({
    include: { _count: { select: { stockEntries: true } } },
    orderBy: [{ city: "asc" }, { name: "asc" }],
  });
}

/**
 * Clients for the stock entry form. Naming a client on an entry is part of
 * creating stock, so this is gated on the stock keys rather than clients.view —
 * and it deliberately returns no GST number or address, which stay behind
 * clients.view.
 */
export async function getClientsForEntryForm() {
  await requireAnyPermission([PERMISSIONS.STOCK_CREATE, PERMISSIONS.STOCK_EDIT]);

  return prisma.client.findMany({
    where: { isActive: true },
    select: { id: true, name: true, city: true },
    orderBy: [{ name: "asc" }],
  });
}

/**
 * Clients for the dispatch form. Addressing a consignment is part of
 * dispatching, so this is gated on dispatch.create — a dispatch operator has no
 * reason to hold the stock-entry keys. Returns no GST number or address; those
 * stay behind clients.view.
 */
export async function getClientsForDispatch() {
  await requirePermission(PERMISSIONS.DISPATCH_CREATE);

  return prisma.client.findMany({
    where: { isActive: true },
    select: { id: true, name: true, city: true },
    orderBy: [{ name: "asc" }],
  });
}

/**
 * The client list as a CSV.
 *
 * Its own permission, for the same reason as the vendor export: this file
 * carries GST numbers and addresses, and downloading them is a different act
 * from reading them on screen.
 */
export async function exportClients() {
  await requirePermission(PERMISSIONS.CLIENTS_EXPORT);

  const clients = await prisma.client.findMany({
    include: { _count: { select: { dispatches: true, stockEntries: true } } },
    orderBy: { name: "asc" },
  });

  const headers = [
    "Name",
    "City",
    "GST Number",
    "Address",
    "Status",
    "Consignments",
    "Direct Entries",
    "Added On",
  ];

  const rows = clients.map((c) => [
    c.name,
    c.city,
    c.gstNumber ?? "",
    c.address ?? "",
    c.isActive ? "Active" : "Inactive",
    c._count.dispatches.toString(),
    c._count.stockEntries.toString(),
    new Date(c.createdAt).toLocaleDateString("en-IN"),
  ]);

  await logActivity(
    "EXPORTED",
    "Client",
    undefined,
    `Exported the client list (${rows.length} clients)`
  );

  return { success: true as const, csv: toCsv(headers, rows), rowCount: rows.length };
}

export async function createClient(data: unknown) {
  await requirePermission(PERMISSIONS.CLIENTS_CREATE);

  const parsed = clientSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const name = parsed.data.name.trim();
  const existing = await prisma.client.findUnique({ where: { name } });
  if (existing) return { error: `Client "${name}" already exists` };

  const client = await prisma.client.create({
    data: {
      name,
      city: parsed.data.city.trim(),
      gstNumber: parsed.data.gstNumber?.trim() || null,
      address: parsed.data.address?.trim() || null,
    },
  });

  await logActivity(
    "CREATED",
    "Client",
    client.id,
    `Added client ${client.name} (${client.city})`
  );

  revalidatePath("/clients");
  return { success: true, client };
}

export async function updateClient(id: string, data: unknown) {
  await requirePermission(PERMISSIONS.CLIENTS_EDIT);

  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return { error: "Client not found" };

  const parsed = clientSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const name = parsed.data.name.trim();
  const duplicate = await prisma.client.findFirst({
    where: { name, id: { not: id } },
  });
  if (duplicate) return { error: `Client "${name}" already exists` };

  const updated = await prisma.client.update({
    where: { id },
    data: {
      name,
      city: parsed.data.city.trim(),
      gstNumber: parsed.data.gstNumber?.trim() || null,
      address: parsed.data.address?.trim() || null,
    },
  });

  await logActivity("UPDATED", "Client", id, `Updated client ${updated.name}`);

  revalidatePath("/clients");
  return { success: true, client: updated };
}

export async function toggleClientActive(id: string) {
  await requirePermission(PERMISSIONS.CLIENTS_EDIT);

  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) return { error: "Client not found" };

  const updated = await prisma.client.update({
    where: { id },
    data: { isActive: !client.isActive },
  });

  await logActivity(
    "UPDATED",
    "Client",
    id,
    `${updated.isActive ? "Activated" : "Deactivated"} client ${updated.name}`
  );

  revalidatePath("/clients");
  return { success: true, client: updated };
}

/**
 * Removes a client. Entries and dispatches snapshot the client's name and city,
 * so unlinking keeps history readable — but a client named on a dispatch is
 * also the answer to "who received this batch", which is why deactivating is
 * recommended first.
 */
export async function deleteClient(id: string, options: { force?: boolean } = {}) {
  const user = await requirePermission(PERMISSIONS.CLIENTS_DELETE);

  const client = await prisma.client.findUnique({
    where: { id },
    include: { _count: { select: { stockEntries: true, dispatches: true } } },
  });
  if (!client) return { error: "Client not found" };

  const { stockEntries, dispatches } = client._count;

  if (!options.force && (stockEntries > 0 || dispatches > 0)) {
    const parts = [
      stockEntries > 0 && `${stockEntries} stock entr${stockEntries === 1 ? "y" : "ies"}`,
      dispatches > 0 && `${dispatches} dispatch${dispatches === 1 ? "" : "es"}`,
    ].filter(Boolean);

    return {
      needsConfirmation: true,
      message: `${client.name} is on ${parts.join(" and ")}.`,
      recommendation:
        "Deactivating removes them from the pickers while keeping the record — which is what a batch recall follows to find who received the goods.",
    };
  }

  let recycleId = "";
  await prisma.$transaction(async (tx) => {
    const [entries, dispatchList] = await Promise.all([
      tx.stockEntry.findMany({ where: { clientId: id }, select: { id: true } }),
      tx.dispatch.findMany({ where: { clientId: id }, select: { id: true } }),
    ]);

    const { _count, ...snapshot } = client;
    recycleId = await archive(tx, {
      entity: "Client",
      entityId: id,
      label: client.name,
      snapshot,
      relinks: [
        { table: "StockEntry", field: "clientId", ids: entries.map((e) => e.id) },
        { table: "Dispatch", field: "clientId", ids: dispatchList.map((d) => d.id) },
      ],
      deletedById: user.id,
    });

    await tx.stockEntry.updateMany({ where: { clientId: id }, data: { clientId: null } });
    await tx.dispatch.updateMany({ where: { clientId: id }, data: { clientId: null } });
    await tx.client.delete({ where: { id } });
  });

  await logActivity("DELETED", "Client", id, `Deleted client ${client.name}`);

  revalidatePath("/clients");
  revalidatePath("/dispatch");
  revalidatePath("/recycle-bin");
  return { success: true, recycleId };
}
