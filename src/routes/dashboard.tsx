import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Users, CreditCard, RefreshCw, Wifi, Clock } from "lucide-react";
import {
  getClientReferenceById,
  getClients,
  getLastSync,
  getPayments,
  getPendingCount,
  isOnline,
  formatTND,
  formatDateTimeFR,
} from "@/lib/data";
import { formatTunisianPhoneForDisplay } from "@/lib/tunisianPhone";
import { useAppData } from "@/lib/useAppData";
import { useHasMounted } from "@/hooks/useHasMounted";

export const Route = createFileRoute("/dashboard")({ component: Dashboard });

function StatCard({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent: string }) {
  return (
    <Card className="p-5 shadow-card">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${accent}`}>
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
  const total = payments.reduce((s, p) => s + p.montant, 0);
  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Tableau de bord</h1>
        <p className="text-sm text-muted-foreground">Vue d'ensemble de votre activité</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard icon={Users} label="Nombre de clients" value={String(clients.length)} accent="bg-info/15 text-info" />
        <StatCard icon={CreditCard} label="Total des paiements" value={formatTND(total)} accent="bg-success/15 text-[oklch(0.45_0.15_150)]" />
        <StatCard icon={RefreshCw} label="En attente de sync" value={String(pending)} accent="bg-warning/15 text-warning-foreground" />
        <StatCard icon={Wifi} label="Statut de connexion" value={online ? "Connecté" : "Hors ligne"} accent={online ? "bg-success/15 text-[oklch(0.45_0.15_150)]" : "bg-destructive/15 text-destructive"} />
        <StatCard icon={Clock} label="Dernière synchronisation" value={last ? `${formatDateTimeFR(last).date} ${formatDateTimeFR(last).time}` : "Jamais"} accent="bg-accent text-accent-foreground" />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5 shadow-card">
          <h3 className="mb-4 text-base font-semibold">Derniers paiements</h3>
          {payments.length === 0 ? <p className="text-sm text-muted-foreground">Aucun paiement.</p> : (
            <div className="space-y-2">
              {payments.slice(0, 5).map((p) => {
                const c = getClientReferenceById(p.client_id);
                return (
                  <div key={p.id} className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">{c?.nom_complet ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{p.date_paiement} · {p.heure_paiement}</div>
                    </div>
                    <div className="text-sm font-semibold">{formatTND(p.montant)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <Card className="p-5 shadow-card">
          <h3 className="mb-4 text-base font-semibold">Derniers clients</h3>
          {clients.length === 0 ? <p className="text-sm text-muted-foreground">Aucun client.</p> : (
            <div className="space-y-2">
              {clients.slice(0, 5).map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{c.nom_complet}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatTunisianPhoneForDisplay(c.telephone) || c.telephone}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">{c.email}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppLayout>
  );
}
