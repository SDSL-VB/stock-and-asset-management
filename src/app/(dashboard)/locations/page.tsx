import { requireAnyPermission } from "@/lib/rbac/check";
import { PERMISSIONS, LOCATIONS_PAGE_PERMISSIONS } from "@/lib/rbac/permissions";
import { getLocations } from "@/lib/actions/locations";
import { PageHeader } from "@/components/shared/page-header";
import { LocationList } from "./_components/location-list";

/** Locations: the sites departments, people and stock belong to. See actions/locations.ts. */
export default async function LocationsPage() {
  const user = await requireAnyPermission(LOCATIONS_PAGE_PERMISSIONS);
  const locations = await getLocations();

  return (
    <div className="space-y-6">
      <PageHeader title="Locations" description="The sites departments, people and stock belong to" />
      <LocationList
        locations={locations}
        canCreate={user.permissions.includes(PERMISSIONS.LOCATIONS_CREATE)}
        canEdit={user.permissions.includes(PERMISSIONS.LOCATIONS_EDIT)}
      />
    </div>
  );
}
