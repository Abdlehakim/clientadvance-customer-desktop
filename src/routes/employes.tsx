import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useState } from "react";
import type { FormEvent } from "react";
import { KeyRound, ShieldAlert, Trash2, UserPlus } from "lucide-react";
import type { EmployeeAccount } from "@/domain/types";
import { AppLayout } from "@/components/AppLayout";
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
  deleteEmployeeAccount,
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

function replaceEmployeeDisplayText(value: string) {
  return value.replace(/\b(employés|employé|employes|employe|employees|employee)\b/gi, "E-user");
}

function getErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Opération impossible.";
  return replaceEmployeeDisplayText(message);
}

function getRoleDisplayLabel(role: EmployeeAccount["role"]) {
  return role === "employe" ? "E-user" : role;
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
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordTarget, setPasswordTarget] = useState<EmployeeAccount | null>(null);
  const [nextPassword, setNextPassword] = useState("");
  const [employeeToDelete, setEmployeeToDelete] = useState<EmployeeAccount | null>(null);

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

  const onAddEmployee = () => {
    if (employeeLimitReached) {
      toast.error(EMPLOYEE_LIMIT_REACHED_MESSAGE);
      return;
    }

    resetForm();
    setCreateDialogOpen(true);
  };

  const onCreateDialogOpenChange = (open: boolean) => {
    setCreateDialogOpen(open);

    if (!open) {
      resetForm();
    }
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
      setCreateDialogOpen(false);
      resetForm();
      toast.success(
        serverMode === "without-server"
          ? "Compte E-user créé localement avec succès"
          : "Compte E-user créé avec succès",
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
      toast.success(employee.is_active ? "Compte E-user désactivé." : "Compte E-user activé.");
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
      toast.success("Mot de passe E-user mis à jour.");
      setPasswordTarget(null);
      setNextPassword("");
      await refreshEmployees();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusyUserId(null);
    }
  };

  const onDeleteEmployee = async () => {
    if (!employeeToDelete) {
      return;
    }

    if (employeeToDelete.id === user?.id) {
      toast.error("Impossible de supprimer l’E-user.");
      setEmployeeToDelete(null);
      return;
    }

    setBusyUserId(employeeToDelete.id);

    try {
      await deleteEmployeeAccount(employeeToDelete.id);
      toast.success("E-user supprimé.");
      setEmployeeToDelete(null);
      await refreshEmployees();
    } catch {
      toast.error("Impossible de supprimer l’E-user.");
      setEmployeeToDelete(null);
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <AppLayout>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gestion des E-user</h1>
          <p className="text-sm text-muted-foreground">
            Création et gestion des comptes E-user par l’administrateur
          </p>
          {employeeLimitReached ? (
            <p className="mt-1 text-sm text-destructive">{EMPLOYEE_LIMIT_REACHED_MESSAGE}</p>
          ) : null}
        </div>
        <Button onClick={onAddEmployee} disabled={employeeLimitReached}>
          <UserPlus className="mr-2 h-4 w-4" /> Ajouter un E-user
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card className="p-4 shadow-card">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Liste des E-user</h2>
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
                      Aucun compte E-user.
                    </TableCell>
                  </TableRow>
                ) : (
                  employees.map((employee) => (
                    <TableRow key={employee.id}>
                      <TableCell className="font-medium">{employee.name}</TableCell>
                      <TableCell>{employee.email}</TableCell>
                      <TableCell>{getRoleDisplayLabel(employee.role)}</TableCell>
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
                          {user?.role === "admin" && employee.id !== user.id ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => setEmployeeToDelete(employee)}
                              disabled={busyUserId === employee.id}
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
      </div>

      <AlertDialog
        open={employeeToDelete !== null}
        onOpenChange={(value) => !value && setEmployeeToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cet E-user ?</AlertDialogTitle>
            <AlertDialogDescription>
              {"Cette action est irréversible. Le compte « "}
              {employeeToDelete?.name}
              {" » sera supprimé."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void onDeleteEmployee();
              }}
              disabled={busyUserId === employeeToDelete?.id}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={createDialogOpen} onOpenChange={onCreateDialogOpenChange}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Ajouter un E-user</DialogTitle>
          </DialogHeader>

          <form className="space-y-4 py-2" onSubmit={onCreate}>
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
              <Input id="employee-role" value="E-user" disabled readOnly />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onCreateDialogOpenChange(false)}
                disabled={submitting}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={submitting || employeeLimitReached}>
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
              Définissez un nouveau mot de passe pour {passwordTarget?.name ?? "cet E-user"}.
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
