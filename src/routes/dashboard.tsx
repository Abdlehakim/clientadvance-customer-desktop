import { createFileRoute } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Clock, CreditCard, RefreshCw, Users, Wifi } from "lucide-react";

import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { useHasMounted } from "@/hooks/useHasMounted";
import {
  formatDateTimeFR,
  formatTND,
  getClientReferenceById,
  getClients,
  getLastSync,
  getPayments,
  getPendingCount,
  isOnline,
} from "@/lib/data";
import { formatTunisianPhoneForDisplay } from "@/lib/tunisianPhone";
import { useAppData } from "@/lib/useAppData";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

type StatCardProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  accent: string;
};

function StatCard({ icon: Icon, label, value, accent }: StatCardProps) {
  return (
    <Card className="p-5 shadow-card">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-1 wrap-break-word text-xl font-semibold leading-tight tracking-tight">
            {value}
          </div>
        </div>

        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function Dashboard() {
  useAppData();

  const mounted = useHasMounted();

  if (!mounted) {
    return <div className="min-h-screen w-full bg-background" />;
  }

  const clients = getClients();
  const payments = getPayments();
  const pending = getPendingCount();
  const online = isOnline();
  const last = getLastSync();
  const lastSync = last ? formatDateTimeFR(last) : null;

  const total = payments.reduce((sum, payment) => sum + payment.montant, 0);

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Tableau de bord</h1>
        <p className="text-sm text-muted-foreground">Vue d&apos;ensemble de votre activité</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          icon={Users}
          label="Nombre de clients"
          value={String(clients.length)}
          accent="bg-info/15 text-info"
        />

        <StatCard
          icon={CreditCard}
          label="Total des paiements"
          value={formatTND(total)}
          accent="bg-success/15 text-[oklch(0.45_0.15_150)]"
        />

        <StatCard
          icon={RefreshCw}
          label="En attente de sync"
          value={String(pending)}
          accent="bg-warning/15 text-warning-foreground"
        />

        <StatCard
          icon={Wifi}
          label="Statut de connexion"
          value={online ? "Connecté" : "Hors ligne"}
          accent={
            online
              ? "bg-success/15 text-[oklch(0.45_0.15_150)]"
              : "bg-destructive/15 text-destructive"
          }
        />

        <StatCard
          icon={Clock}
          label="Dernière synchronisation"
          value={lastSync ? `${lastSync.date} ${lastSync.time}` : "Jamais"}
          accent="bg-accent text-accent-foreground"
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5 shadow-card">
          <h3 className="mb-4 text-base font-semibold">Derniers paiements</h3>

          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun paiement.</p>
          ) : (
            <div className="space-y-2">
              {payments.slice(0, 5).map((payment) => {
                const client = getClientReferenceById(payment.client_id);

                return (
                  <div
                    key={payment.id}
                    className="flex items-center justify-between rounded-md border bg-card px-3 py-2"
                  >
                    <div>
                      <div className="text-sm font-medium">{client?.nom_complet ?? "—"}</div>

                      <div className="text-xs text-muted-foreground">
                        {payment.date_paiement} · {payment.heure_paiement}
                      </div>
                    </div>

                    <div className="text-sm font-semibold">{formatTND(payment.montant)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="p-5 shadow-card">
          <h3 className="mb-4 text-base font-semibold">Derniers clients</h3>

          {clients.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun client.</p>
          ) : (
            <div className="space-y-2">
              {clients.slice(0, 5).map((client) => (
                <div
                  key={client.id}
                  className="flex items-center justify-between rounded-md border bg-card px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-medium">{client.nom_complet}</div>

                    <div className="text-xs text-muted-foreground">
                      {formatTunisianPhoneForDisplay(client.telephone) || client.telephone}
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">{client.email}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
