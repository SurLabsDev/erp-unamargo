import { AppHeader } from "@/components/app-header";
import { requireUser } from "@/lib/auth-helpers";
import { getSettings } from "@/lib/settings";
import { logoutAction } from "./actions";

// All app pages depend on session + DB: never prerender at build time.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const settings = await getSettings();

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader
        companyName={settings.companyName}
        userName={user.name}
        role={user.role}
        onLogout={logoutAction}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>
      <footer className="border-t">
        <div className="mx-auto w-full max-w-6xl px-4 py-3 text-xs text-muted-foreground sm:px-6">
          {settings.companyName} · Sistema de gestión operativo · Surlabs
        </div>
      </footer>
    </div>
  );
}
