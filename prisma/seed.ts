/**
 * Fills an EMPTY database with everything the app needs to run.
 *
 *   npm run db:seed
 *
 * This wipes first. Never run it against real data — use
 * `setup-roles-and-people.ts` to update roles and people on a live database.
 *
 * What it creates, in dependency order: the permission catalog, the two sites
 * and their departments, the roles, the people, and the small amount of
 * reference data the app cannot start without (attachment types and the stock
 * approval flow).
 *
 * The role and people definitions are NOT repeated here — they come from
 * `setup-roles-and-people.ts`, which is the one place they live. The old seed
 * kept its own copy and drifted 41 permissions behind, which meant running it
 * produced a broken install.
 */
import { PrismaClient } from "@prisma/client";
import { PERMISSION_CATALOG } from "./lib/permission-catalog";
import { applyRolesAndPeople, DEFAULT_PASSWORD } from "./setup-roles-and-people";

const prisma = new PrismaClient();

/** The two sites, and the departments at each. */
const LOCATIONS = [
  {
    name: "Bengaluru",
    code: "BLR",
    departments: [
      // Every site needs exactly one central stock department: it is where
      // received goods land, and it is how operators acquire a location.
      { name: "Central Stock — Bengaluru", isCentralStock: true },
      { name: "Production", isCentralStock: false },
      { name: "R&D", isCentralStock: false },
      { name: "Accounts", isCentralStock: false },
      { name: "Dispatch Blore", isCentralStock: false },
    ],
  },
  {
    name: "Hyderabad",
    code: "HYD",
    departments: [
      { name: "Central Stock — Hyderabad", isCentralStock: true },
      { name: "Sales", isCentralStock: false },
      { name: "Dispatch Hyd", isCentralStock: false },
    ],
  },
];

/** Document types an entry can carry. Invoice is required before submitting. */
const ATTACHMENT_TYPES = [
  { name: "Invoice", isRequired: true, maxSizeBytes: 10_485_760 },
  { name: "Bill", isRequired: false, maxSizeBytes: 10_485_760 },
  { name: "Delivery Note", isRequired: false, maxSizeBytes: 5_242_880 },
];

const DOCUMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"];

async function wipe() {
  // Children before parents. Anything with a foreign key has to go first.
  await prisma.buildConsumption.deleteMany();
  await prisma.build.deleteMany();
  await prisma.bomLine.deleteMany();
  await prisma.billOfMaterials.deleteMany();
  await prisma.dispatchItem.deleteMany();
  await prisma.dispatch.deleteMany();
  await prisma.siteRequest.deleteMany();
  await prisma.purchaseOrderLine.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.purchaseIntent.deleteMany();
  await prisma.procurementFlowConfig.deleteMany();
  await prisma.stockTransferRequest.deleteMany();
  await prisma.productRequest.deleteMany();
  await prisma.stockIssue.deleteMany();
  await prisma.stockApproval.deleteMany();
  await prisma.stockEntryWarranty.deleteMany();
  await prisma.stockEntryAttachment.deleteMany();
  await prisma.stockEntry.deleteMany();
  await prisma.product.deleteMany();
  await prisma.productCategory.deleteMany();
  await prisma.approvalFlowStep.deleteMany();
  await prisma.approvalFlowConfig.deleteMany();
  await prisma.bomFlowConfig.deleteMany();
  await prisma.attachmentTypeConfig.deleteMany();
  await prisma.stockEntryFieldConfig.deleteMany();
  await prisma.deletedRecord.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.userPermission.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.department.deleteMany();
  await prisma.location.deleteMany();
}

async function main() {
  console.log("Seeding a fresh database.\n");

  await wipe();
  console.log("  cleared");

  await prisma.permission.createMany({ data: PERMISSION_CATALOG });
  console.log(`  ${PERMISSION_CATALOG.length} permissions`);

  for (const site of LOCATIONS) {
    const location = await prisma.location.create({
      data: { name: site.name, code: site.code },
    });
    for (const department of site.departments) {
      await prisma.department.create({
        data: {
          name: department.name,
          isCentralStock: department.isCentralStock,
          locationId: location.id,
        },
      });
    }
    console.log(`  ${site.name}: ${site.departments.length} departments`);
  }

  // The roles, the people, and the stock approval flow — one definition,
  // shared with the script that updates a live database.
  await applyRolesAndPeople(prisma, { log: (line: string) => console.log(`  ${line}`) });

  await prisma.attachmentTypeConfig.createMany({
    data: ATTACHMENT_TYPES.map((type) => ({
      ...type,
      isActive: true,
      allowedMimeTypes: DOCUMENT_MIME_TYPES,
    })),
  });
  console.log(`  ${ATTACHMENT_TYPES.length} attachment types`);

  console.log(`\nDone. Everyone's password is ${DEFAULT_PASSWORD} — change them.`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
