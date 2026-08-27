import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getClients } from "@/lib/actions/clients";
import { PageHeader } from "@/components/shared/page-header";
import { HowTo } from "@/components/shared/how-to";
import { ClientManager } from "./_components/client-manager";

export default async function ClientsPage() {
  const user = await requireAnyPermission([
    PERMISSIONS.CLIENTS_VIEW,
    PERMISSIONS.CLIENTS_CREATE,
    PERMISSIONS.CLIENTS_EDIT,
  ]);
  const has = (p: string) => user.permissions.includes(p);

  const clients = await getClients();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Customers we dispatch to, with their GST and address details"
      >
        <HowTo
          title="Managing clients"
          intro="Clients are records, not typed names — so a dispatch always points at the same customer."
          sections={[
            {
              steps: [
                { title: "Add a client once", description: "Name, city, GST number and address. The city is what the client list and outgoing stock are filtered by." },
                { title: "Pick clients, never type them", description: "Stock that ships straight from a vendor to a customer books in against a location and names the client from this list." },
                { title: "Deactivate instead of deleting", description: "A deactivated client disappears from pickers but keeps every past entry intact." },
              ],
            },
          ]}
        />
      </PageHeader>
      <ClientManager
        clients={clients}
        canCreate={has(PERMISSIONS.CLIENTS_CREATE)}
        canEdit={has(PERMISSIONS.CLIENTS_EDIT)}
        canDelete={has(PERMISSIONS.CLIENTS_DELETE)}
        canExport={has(PERMISSIONS.CLIENTS_EXPORT)}
      />
    </div>
  );
}
