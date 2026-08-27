import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getUsers } from "@/lib/actions/users";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UserPlus } from "lucide-react";
import Link from "next/link";
import { UserDirectory } from "./_components/user-directory";

export default async function UsersPage() {
  const currentUser = await requirePermission(PERMISSIONS.USERS_VIEW);
  const users = await getUsers();

  // One page, one vocabulary, for everyone. What differs between people is what
  // they are allowed to do — never the shape of the page or what it is called.
  const canCreate = currentUser.permissions.includes(PERMISSIONS.USERS_CREATE);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team Members"
        description="Everyone with an account, grouped by the department they belong to"
      >
        {canCreate && (
          <Link
            href="/users/new"
            className={cn(
              buttonVariants(),
              "bg-brand-green hover:bg-brand-green/90 text-brand-navy font-semibold"
            )}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Add Team Member
          </Link>
        )}
      </PageHeader>

      <UserDirectory users={users} currentUserId={currentUser.id} />
    </div>
  );
}
