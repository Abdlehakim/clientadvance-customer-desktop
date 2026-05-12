import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { AdminSettingsFormCard } from "@/components/AdminSettingsFormCard";
import { AppLayout } from "@/components/AppLayout";
import { DatabaseLocationCard } from "@/components/DatabaseLocationCard";
import { LicenseInfoCard } from "@/components/LicenseInfoCard";
import { Card } from "@/components/ui/card";
import { useHasMounted } from "@/hooks/useHasMounted";
import {
  BACKEND_SYNC_DISABLED_MESSAGE,
  WHATSAPP_BACKEND_REQUIRED_MESSAGE,
} from "@/infrastructure/local/adminSettingsState";
import { getAdminSettings, getCurrentUser } from "@/lib/data";
import { useAppData } from "@/lib/useAppData";

export const Route = createFileRoute("/parametres")({ component: SettingsPage });

function SettingsPage() {
  useAppData();
  const mounted = useHasMounted();
  const user = mounted ? getCurrentUser() : null;
  const isAdmin = user?.role === "admin";
  const settings = mounted && isAdmin ? getAdminSettings() : null;

  if (!mounted) {
    return <div className="min-h-screen w-full bg-background" />;
  }

  if (!isAdmin) {
    return (
      <AppLayout>
        <Card className="mx-auto max-w-lg p-8 text-center shadow-card">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <h2 className="text-lg font-semibold">Accès refusé</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Accès refusé. Cette section est réservée à l'administrateur.
          </p>
        </Card>
      </AppLayout>
    );
  }

  if (!settings) {
    return <div className="min-h-screen w-full bg-background" />;
  }

  const isWithoutServerMode = settings.server_mode === "without-server";

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Paramètres administrateur</h1>
        <p className="text-sm text-muted-foreground">
          Configurer les destinataires, le mode de fonctionnement et l'email SMTP.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <AdminSettingsFormCard
          settings={settings}
          showSmtpTestButton
          showSmtpPasswordToggle
        />

        <div className="space-y-4">
          <LicenseInfoCard />

          <Card className="p-6 shadow-card">
            <h3 className="font-semibold">Notifications en attente</h3>
            {isWithoutServerMode ? (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  {BACKEND_SYNC_DISABLED_MESSAGE}
                </p>
                <p className="mt-4 text-sm text-muted-foreground">
                  {WHATSAPP_BACKEND_REQUIRED_MESSAGE}
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  Les notifications email et WhatsApp sont gérées par le serveur backend.
                </p>
                <p className="mt-4 text-sm text-muted-foreground">
                  La synchronisation avec le backend reste active dans ce mode.
                </p>
              </>
            )}
          </Card>

          <DatabaseLocationCard />
        </div>
      </div>
    </AppLayout>
  );
}
