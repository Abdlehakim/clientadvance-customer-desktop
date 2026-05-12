import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Plus } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { PaymentFormDialog } from "@/components/PaymentFormDialog";
import { SyncBadge } from "@/components/SyncBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useHasMounted } from "@/hooks/useHasMounted";
import {
  formatDateFR,
  formatTND,
  getClientReferenceById,
  getPaymentsByClient,
} from "@/lib/data";
import { formatTunisianPhoneForDisplay } from "@/lib/tunisianPhone";
import { useAppData } from "@/lib/useAppData";

export const Route = createFileRoute("/clients/$clientId")({ component: ClientProfile });

function ClientProfile() {
  useAppData();
  const mounted = useHasMounted();
  const [open, setOpen] = useState(false);
  const { clientId } = Route.useParams();

  if (!mounted) {
    return <div className="min-h-screen w-full bg-background" />;
  }

  const client = getClientReferenceById(clientId);
  const payments = getPaymentsByClient(clientId);

  if (!client) {
    return (
      <AppLayout>
        <Card className="p-6">Client introuvable.</Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link to="/clients">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{client.nom_complet}</h1>
            <p className="text-sm text-muted-foreground">Profil client</p>
          </div>
        </div>
        <SyncBadge status={client.sync_status} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5 shadow-card lg:col-span-1">
          <h3 className="mb-4 text-base font-semibold">Informations personnelles</h3>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">{"T\u00e9l\u00e9phone"}</dt>
              <dd className="font-medium">
                {formatTunisianPhoneForDisplay(client.telephone) || client.telephone || "\u2014"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd className="font-medium">{client.email || "\u2014"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">CIN</dt>
              <dd className="font-medium">{client.cin || "\u2014"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Adresse</dt>
              <dd className="font-medium">{client.adresse || "\u2014"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{"Cr\u00e9\u00e9 par"}</dt>
              <dd className="font-medium">{client.created_by}</dd>
            </div>
          </dl>
        </Card>

        <Card className="p-5 shadow-card lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold">Historique des paiements</h3>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Ajouter un paiement
            </Button>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Heure</TableHead>
                  <TableHead>Montant</TableHead>
                  <TableHead>{"Enregistr\u00e9 par"}</TableHead>
                  <TableHead>Synchronisation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                      Aucun paiement.
                    </TableCell>
                  </TableRow>
                ) : (
                  payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>{formatDateFR(payment.date_paiement)}</TableCell>
                      <TableCell>{payment.heure_paiement}</TableCell>
                      <TableCell className="font-medium">{formatTND(payment.montant)}</TableCell>
                      <TableCell>{payment.created_by}</TableCell>
                      <TableCell>
                        <SyncBadge status={payment.sync_status} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      <PaymentFormDialog open={open} onOpenChange={setOpen} presetClientId={client.id} />
    </AppLayout>
  );
}
