import { requirePermission } from "@/lib/rbac/check";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Settings, Construction } from "lucide-react";

export default async function SettingsPage() {
  await requirePermission(PERMISSIONS.SETTINGS_VIEW);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="System configuration and preferences"
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="h-5 w-5 text-brand-blue" />
            Coming Soon
          </CardTitle>
          <CardDescription>
            System settings will be available in a future update.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center py-8 text-center">
            <Settings className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">
              This area will include system configuration, notification
              settings, and more.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
