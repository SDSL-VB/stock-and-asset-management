import { requireAuth } from "@/lib/rbac/check";
import { PageHeader } from "@/components/shared/page-header";
import { ProfileForm } from "./_components/profile-form";

export default async function ProfilePage() {
  const user = await requireAuth();

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Profile"
        description="View and update your personal information"
      />
      <ProfileForm
        user={{
          name: user.name ?? "",
          email: user.email ?? "",
          role: user.role,
        }}
      />
    </div>
  );
}
