import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActivityLogs, getCurrentUser, formatDateTimeFR } from "@/lib/data";
import { useAppData } from "@/lib/useAppData";
import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useHasMounted } from "@/hooks/useHasMounted";

export const Route = createFileRoute("/journal")({ component: JournalPage });

const actionLabels: Record<string, string> = {
  login: "Connexion",
  client_create: "Création client",
  client_update: "Modification client",
  client_delete: "Suppression client",
  payment_create: "Création paiement",
  settings_update: "Paramètres",
  sync: "Synchronisation",
  employee_create: "Création employé",
  employee_status_update: "Statut employé",
  employee_password_reset: "Mot de passe employé",
};

function JournalPage() {
  useAppData();
  const mounted = useHasMounted();
  const [u, setU] = useState("all");
  const [a, setA] = useState("all");
  const [d, setD] = useState("");

  if (!mounted) {
    return <div className="min-h-screen w-full bg-background" />;
  }

  const user = getCurrentUser();

  if (user?.role !== "admin") {
    return (
      <AppLayout>
        <Card className="mx-auto max-w-lg p-8 text-center shadow-card">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <h2 className="text-lg font-semibold">Accès refusé</h2>
          <p className="mt-1 text-sm text-muted-foreground">Cette section est réservée à l'administrateur.</p>
        </Card>
      </AppLayout>
    );
  }

  const logs = getActivityLogs();
  const users = Array.from(new Set(logs.map((l) => l.user_name)));
  const actions = Array.from(new Set(logs.map((l) => l.action_type)));
  const filtered = logs.filter((l) => {
    if (u !== "all" && l.user_name !== u) return false;
    if (a !== "all" && l.action_type !== a) return false;
    if (d && !l.created_at.startsWith(d)) return false;
    return true;
  });

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Journal des activités</h1>
        <p className="text-sm text-muted-foreground">Toutes les actions effectuées dans l'application</p>
      </div>
      <Card className="p-4 shadow-card">
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Select value={u} onValueChange={setU}>
            <SelectTrigger><SelectValue placeholder="Utilisateur" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les utilisateurs</SelectItem>
              {users.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={a} onValueChange={setA}>
            <SelectTrigger><SelectValue placeholder="Action" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les actions</SelectItem>
              {actions.map((x) => <SelectItem key={x} value={x}>{actionLabels[x] ?? x}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={d} onChange={(e) => setD(e.target.value)} />
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Heure</TableHead>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Donnée concernée</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">Aucune activité.</TableCell></TableRow>
              ) : filtered.map((l) => {
                const dt = formatDateTimeFR(l.created_at);
                return (
                  <TableRow key={l.id}>
                    <TableCell>{dt.date}</TableCell>
                    <TableCell>{dt.time}</TableCell>
                    <TableCell>{l.user_name}</TableCell>
                    <TableCell><Badge variant="outline">{actionLabels[l.action_type] ?? l.action_type}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{l.entity_type}</TableCell>
                    <TableCell>{l.description}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </AppLayout>
  );
}
