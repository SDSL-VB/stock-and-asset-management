import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";
import { PageTransition } from "@/components/motion";
import { LiveData } from "@/components/shared/live-data";
import { auth } from "@/auth";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    <SidebarProvider>
      {/* Other people's changes appear without anyone pressing reload */}
      <LiveData />
      <AppSidebar session={session} />
      <SidebarInset>
        <AppTopbar session={session} />
        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <PageTransition>{children}</PageTransition>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
