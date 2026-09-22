import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppTopbar } from "@/components/layout/app-topbar";
import { PageTransition } from "@/components/motion";
import { LiveData } from "@/components/shared/live-data";
import { auth } from "@/auth";
import { after } from "next/server";
import { runWatchChecks } from "@/lib/notifications/checks";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  // Low stock and late orders are found by looking rather than by an event.
  // After the page is sent, and at most every few minutes across all visitors
  // — see src/lib/notifications/checks.ts.
  after(() => runWatchChecks().catch((e) => console.error("Watch checks failed:", e)));

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
