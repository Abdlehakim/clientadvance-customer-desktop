import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Eye, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { ClientFormDialog } from "@/components/ClientFormDialog";
import { PaymentSyncStatusBadge } from "@/components/PaymentSyncStatusBadge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useHasMounted } from "@/hooks/useHasMounted";
import {
  deleteClient,
  getAdminSettings,
  getAllClients,
  getCurrentUser,
  getLocalSyncStatus,
  getServerSyncStatus,
} from "@/lib/data";
import type { Client } from "@/lib/types";
import {
  formatTunisianPhoneForDisplay,
  getTunisianLocalPhone,
} from "@/lib/tunisianPhone";
import { useAppData } from "@/lib/useAppData";
import { toast } from "sonner";

export const Route = createFileRoute("/clients")({ component: ClientsPage });

function ClientsPage() {
  useAppData();
  const mounted = useHasMounted();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [toDelete, setToDelete] = useState<Client | null>(null);

  if (!mounted) {
    return <div className="min-h-screen w-full bg-background" />;
  }

  const user = getCurrentUser();
  const settings = getAdminSettings();

  const clients = getAllClients().filter((client) => {
    const search = q.toLowerCase();
    const phoneDigits = q.replace(/\D+/g, "");

    return (
      !search ||
      client.nom_complet.toLowerCase().includes(search) ||
      client.telephone.includes(search) ||
      formatTunisianPhoneForDisplay(client.telephone).toLowerCase().includes(search) ||
      (phoneDigits.length > 0 && getTunisianLocalPhone(client.telephone).includes(phoneDigits)) ||
      client.email.toLowerCase().includes(search) ||
      client.cin.includes(search)
    );
  });

  const onAdd = () => {
    setEditing(null);
    setOpen(true);
  };

  const onEdit = (client: Client) => {
    setEditing(client);
    setOpen(true);
  };

  const onDelete = () => {
    if (!toDelete) {
      return;
    }

    deleteClient(toDelete.id);
    toast.success("Client supprim\u00e9");
    setToDelete(null);
  };

  return (
    <AppLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">
            {"G\u00e9rez votre base de clients"}
          </p>
        </div>
        <Button onClick={onAdd}>
          <Plus className="mr-2 h-4 w-4" /> Ajouter un client
        </Button>
      </div>

      <Card className="p-4 shadow-card">
        <div className="mb-4 flex items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Rechercher un client..."
              value={q}
              onChange={(event) => setQ(event.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom complet</TableHead>
                <TableHead>{"T\u00e9l\u00e9phone"}</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>CIN</TableHead>
                <TableHead>Syn.L</TableHead>
                <TableHead>Syn.S</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    {"Aucun client trouv\u00e9."}
                  </TableCell>
                </TableRow>
              ) : (
                clients.map((client) => (
                  <TableRow key={client.id}>
                    <TableCell className="font-medium">{client.nom_complet}</TableCell>
                    <TableCell>
                      {formatTunisianPhoneForDisplay(client.telephone) || client.telephone}
                    </TableCell>
                    <TableCell>{client.email}</TableCell>
                    <TableCell>{client.cin}</TableCell>
                    <TableCell>
                      <PaymentSyncStatusBadge status={getLocalSyncStatus(client)} />
                    </TableCell>
                    <TableCell>
                      <PaymentSyncStatusBadge
                        status={getServerSyncStatus(client, settings)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="ghost" size="icon">
                          <Link to="/clients/$clientId" params={{ clientId: client.id }}>
                            <Eye className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => onEdit(client)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {user?.role === "admin" ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setToDelete(client)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <ClientFormDialog open={open} onOpenChange={setOpen} client={editing} />
      <AlertDialog open={!!toDelete} onOpenChange={(value) => !value && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce client ?</AlertDialogTitle>
            <AlertDialogDescription>
              {"Cette action est irr\u00e9versible. Le client \u00ab "}
              {toDelete?.nom_complet}
              {" \u00bb sera supprim\u00e9."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Supprimer</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
