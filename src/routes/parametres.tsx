import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { AdminSettingsFormCard } from "@/components/AdminSettingsFormCard";
import { AppLayout } from "@/components/AppLayout";
import { DatabaseLocationCard } from "@/components/DatabaseLocationCard";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHasMounted } from "@/hooks/useHasMounted";
import {
  BACKEND_SYNC_DISABLED_MESSAGE,
  WHATSAPP_BACKEND_REQUIRED_MESSAGE,
} from "@/infrastructure/local/adminSettingsState";
import { getAdminSettings, getCurrentUser } from "@/lib/data";
import { useAppData } from "@/lib/useAppData";

export const Route = createFileRoute("/parametres")({ component: SettingsPage });

const SETTINGS_ACTION_BUTTON_CLASS = "w-[260px] max-w-full cursor-pointer disabled:cursor-not-allowed";

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

      <Tabs defaultValue="notifications" className="space-y-4">
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-auto min-w-max justify-start">
            <TabsTrigger value="notifications">Envoi des notifications</TabsTrigger>
            <TabsTrigger value="smtp">Paramètres email SMTP</TabsTrigger>
            <TabsTrigger value="pending">Notifications en attente</TabsTrigger>
            <TabsTrigger value="database">Base de données locale</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="notifications" className="mt-0">
          <AdminSettingsFormCard
            settings={settings}
            actionButtonClassName={SETTINGS_ACTION_BUTTON_CLASS}
            sections={["notifications"]}
          />
        </TabsContent>

        <TabsContent value="smtp" className="mt-0">
          <AdminSettingsFormCard
            settings={settings}
            actionButtonClassName={SETTINGS_ACTION_BUTTON_CLASS}
            title="Paramètres email SMTP"
            sections={["smtp"]}
            showSmtpTestButton
            showSmtpPasswordToggle
          />
        </TabsContent>


        <TabsContent value="pending" className="mt-0">
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
        </TabsContent>

        <TabsContent value="database" className="mt-0">
          <DatabaseLocationCard
            actionButtonClassName={SETTINGS_ACTION_BUTTON_CLASS}
          />
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
