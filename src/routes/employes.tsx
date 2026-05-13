import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useState } from "react";
import type { FormEvent } from "react";
import { KeyRound, ShieldAlert, UserPlus } from "lucide-react";
import type { EmployeeAccount } from "@/domain/types";
import { AppLayout } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createEmployeeAccount,
  EMPLOYEE_LIMIT_REACHED_MESSAGE,
  formatDateFR,
  getAdminSettings,
  getCurrentUser,
  getEmployeeCount,
  getEmployeeAccounts,
  hasReachedEmployeeLimit,
  updateEmployeeAccount,
} from "@/lib/data";
import { useHasMounted } from "@/hooks/useHasMounted";
import { useAppData } from "@/lib/useAppData";
import { toast } from "sonner";

export const Route = createFileRoute("/employes")({ component: EmployeeManagementPage });

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Opération impossible.";
}

function EmployeeManagementPage() {
  useAppData();
  const mounted = useHasMounted();
  const user = mounted ? getCurrentUser() : null;
  const serverMode = getAdminSettings().server_mode;
  const [employees, setEmployees] = useState<EmployeeAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [listStatusNote, setListStatusNote] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordTarget, setPasswordTarget] = useState<EmployeeAccount | null>(null);
  const [nextPassword, setNextPassword] = useState("");

  const refreshEmployees = useEffectEvent(async () => {
    setLoading(true);

    try {
      const result = await getEmployeeAccounts();
      setEmployees(result.employees);
      setListStatusNote(
        result.source === "local" && result.serverUnavailable
          ? "Liste locale affichée. Serveur indisponible."
          : null,
      );
    } catch (error) {
      setListStatusNote(null);
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    if (!mounted || user?.role !== "admin") {
      return;
    }

    void refreshEmployees();
  }, [mounted, serverMode, user?.role]);

  if (!mounted) {
    return <div className="min-h-screen w-full bg-background" />;
  }

  if (user?.role !== "admin") {
    return (
      <AppLayout>
        <Card className="mx-auto max-w-lg p-8 text-center shadow-card">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <h2 className="text-lg font-semibold">Accès refusé</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Accès refusé. Cette section est réservée à l’administrateur.
          </p>
        </Card>
      </AppLayout>
    );
  }

  const employeeCount = getEmployeeCount(employees);
  const employeeLimitReached = hasReachedEmployeeLimit(employees);

  const resetForm = () => {
    setName("");
    setEmail("");
    setPassword("");
  };

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();

    if (employeeLimitReached) {
      toast.error(EMPLOYEE_LIMIT_REACHED_MESSAGE);
      return;
    }

    setSubmitting(true);

    try {
      await createEmployeeAccount({
        name: name.trim(),
        email: email.trim(),
        password,
        role: "employe",
      });
      resetForm();
      toast.success(
        serverMode === "without-server"
          ? "Compte employé créé localement avec succès"
          : "Compte employé créé avec succès",
      );
      await refreshEmployees();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const onToggleActive = async (employee: EmployeeAccount) => {
    setBusyUserId(employee.id);

    try {
      await updateEmployeeAccount(employee.id, {
        is_active: !employee.is_active,
      });
      toast.success(employee.is_active ? "Compte employé désactivé." : "Compte employé activé.");
      await refreshEmployees();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyUserId(null);
    }
  };

  const onSavePassword = async () => {
    if (!passwordTarget) {
      return;
    }

    setBusyUserId(passwordTarget.id);

    try {
      await updateEmployeeAccount(passwordTarget.id, {
        password: nextPassword,
      });
      toast.success("Mot de passe employé mis à jour.");
      setPasswordTarget(null);
      setNextPassword("");
      await refreshEmployees();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Gestion des employés</h1>
        <p className="text-sm text-muted-foreground">
          Création et gestion des comptes employés par l’administrateur
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
        <Card className="p-6 shadow-card">
          <div className="mb-4 flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-primary" />
            <h2 className="font-semibold">Ajouter un employé</h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            {serverMode === "with-server"
              ? "Le compte est créé sur le serveur puis enregistré localement sur cet appareil."
              : "Le compte est créé localement sur cet appareil, sans synchronisation backend."}
          </p>

          <form className="space-y-4" onSubmit={onCreate}>
            <div className="space-y-1.5">
              <Label htmlFor="employee-name">Nom</Label>
              <Input
                id="employee-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={submitting || employeeLimitReached}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="employee-email">Email</Label>
              <Input
                id="employee-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={submitting || employeeLimitReached}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="employee-password">Mot de passe</Label>
              <Input
                id="employee-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting || employeeLimitReached}
                minLength={6}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="employee-role">Rôle</Label>
              <Input id="employee-role" value="employe" disabled readOnly />
            </div>

            {employeeLimitReached ? (
              <p className="text-sm text-destructive">{EMPLOYEE_LIMIT_REACHED_MESSAGE}</p>
            ) : null}

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={submitting || employeeLimitReached}>
                Enregistrer
              </Button>
              <Button type="button" variant="outline" onClick={resetForm} disabled={submitting}>
                Annuler
              </Button>
            </div>
          </form>
        </Card>

        <Card className="p-4 shadow-card">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Liste des employés</h2>
              <p className="text-sm text-muted-foreground">
                {serverMode === "with-server"
                  ? "La liste du serveur est utilisée en priorité et recopiée localement."
                  : "La liste locale est utilisée sans serveur backend."}
              </p>
              {listStatusNote ? (
                <p className="mt-1 text-sm text-muted-foreground">{listStatusNote}</p>
              ) : null}
            </div>
            <Badge variant="outline">{employeeCount} compte(s)</Badge>
          </div>

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Créé le</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      Chargement...
                    </TableCell>
                  </TableRow>
                ) : employees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      Aucun compte employé.
                    </TableCell>
                  </TableRow>
                ) : (
                  employees.map((employee) => (
                    <TableRow key={employee.id}>
                      <TableCell className="font-medium">{employee.name}</TableCell>
                      <TableCell>{employee.email}</TableCell>
                      <TableCell>{employee.role}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            employee.is_active
                              ? "border-success/40 bg-success/10 text-[oklch(0.35_0.1_150)]"
                              : "border-destructive/40 bg-destructive/10 text-destructive"
                          }
                        >
                          {employee.is_active ? "Actif" : "Désactivé"}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDateFR(employee.created_at)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void onToggleActive(employee)}
                            disabled={busyUserId === employee.id}
                          >
                            {employee.is_active ? "Désactiver" : "Activer"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setPasswordTarget(employee);
                              setNextPassword("");
                            }}
                            disabled={busyUserId === employee.id}
                          >
                            <KeyRound className="mr-2 h-4 w-4" />
                            Mot de passe
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>

      <Dialog
        open={passwordTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPasswordTarget(null);
            setNextPassword("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Changer le mot de passe</DialogTitle>
            <DialogDescription>
              Définissez un nouveau mot de passe pour {passwordTarget?.name ?? "cet employé"}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="employee-reset-password">Mot de passe</Label>
            <Input
              id="employee-reset-password"
              type="password"
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
              minLength={6}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPasswordTarget(null);
                setNextPassword("");
              }}
            >
              Annuler
            </Button>
            <Button
              type="button"
              onClick={() => void onSavePassword()}
              disabled={
                nextPassword.trim().length < 6 ||
                (passwordTarget !== null && busyUserId === passwordTarget.id)
              }
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
