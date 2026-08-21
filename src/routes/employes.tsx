import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useState } from "react";
import type { FormEvent } from "react";
import { Eye, EyeOff, KeyRound, ShieldAlert, Trash2, UserPlus } from "lucide-react";
import type { EmployeeAccount } from "@/domain/types";
import { AppLayout } from "@/components/AppLayout";
import { TunisianPhoneInput } from "@/components/TunisianPhoneInput";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  TUNISIAN_PHONE_VALIDATION_MESSAGE,
  formatTunisianPhoneForDisplay,
  isValidTunisianPhone,
  normalizeTunisianPhone,
} from "@/lib/tunisianPhone";
import { toast } from "sonner";

export const Route = createFileRoute("/employes")({ component: EmployeeManagementPage });

const PASSWORD_UNAVAILABLE_MESSAGE = "Mot de passe non disponible. Veuillez le réinitialiser.";

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
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [passwordTarget, setPasswordTarget] = useState<EmployeeAccount | null>(null);
  const [nextPassword, setNextPassword] = useState("");
  const [employeeToDelete, setEmployeeToDelete] = useState<EmployeeAccount | null>(null);
  const [visiblePasswordIds, setVisiblePasswordIds] = useState<Set<string>>(() => new Set());

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

  useEffect(() => {
    setVisiblePasswordIds((current) => {
      const employeeIds = new Set(employees.map((employee) => employee.id));
      const next = new Set([...current].filter((id) => employeeIds.has(id)));

      return next.size === current.size ? current : next;
    });
  }, [employees]);

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
    setPhone("");
    setPhoneError(null);
    setPassword("");
  };

  const setPasswordVisibility = (employeeId: string, visible: boolean) => {
    setVisiblePasswordIds((current) => {
      const next = new Set(current);

      if (visible) {
        next.add(employeeId);
      } else {
        next.delete(employeeId);
      }

      return next;
    });
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

    if (phone.trim().length > 0 && !isValidTunisianPhone(phone)) {
      setPhoneError(TUNISIAN_PHONE_VALIDATION_MESSAGE);
      return;
    }

    setSubmitting(true);

    try {
      const createdEmployee = await createEmployeeAccount({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim().length > 0 ? normalizeTunisianPhone(phone) : "",
        password,
        role: "employe",
      });
      const createdLocallyWhileServerUnavailable =
        serverMode === "with-server" && createdEmployee.sync_status === "local";
      let createSuccessMessage = "Compte E-user créé avec succès";

      if (serverMode === "without-server") {
        createSuccessMessage = "Compte E-user créé localement avec succès";
      } else if (createdLocallyWhileServerUnavailable) {
        createSuccessMessage =
          "Compte E-user cr\u00e9\u00e9 localement. Serveur indisponible : il ne sera pas synchronis\u00e9 tant que le serveur n'est pas disponible.";
      }

      setCreateDialogOpen(false);
      resetForm();
      toast.success(createSuccessMessage);
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
      const updatedEmployee = await updateEmployeeAccount(employee.id, {
        is_active: !employee.is_active,
      });
      const actionLabel = employee.is_active ? "d\u00e9sactiv\u00e9" : "activ\u00e9";
      const updatedLocally = serverMode === "with-server" && updatedEmployee.pending_sync === true;

      toast.success(
        updatedLocally
          ? `Compte E-user ${actionLabel} localement. Serveur indisponible : la modification sera synchronis\u00e9e plus tard.`
          : `Compte E-user ${actionLabel}.`,
      );
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
      const updatedEmployee = await updateEmployeeAccount(passwordTarget.id, {
        password: nextPassword,
      });
      toast.success(
        serverMode === "with-server" && updatedEmployee.pending_sync === true
          ? "Mot de passe E-user mis \u00e0 jour localement. Serveur indisponible : la modification sera synchronis\u00e9e plus tard."
          : "Mot de passe E-user mis \u00e0 jour.",
      );
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
      const deleteResult = await deleteEmployeeAccount(employeeToDelete.id);
      toast.success(
        deleteResult.localFallback
          ? deleteResult.queuedSync
            ? "E-user supprim\u00e9 localement. Serveur indisponible : la suppression sera synchronis\u00e9e plus tard."
            : "E-user supprim\u00e9 localement."
          : "E-user supprim\u00e9.",
      );
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
                  <TableHead>{"T\u00e9l\u00e9phone"}</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Créé le</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      Chargement...
                    </TableCell>
                  </TableRow>
                ) : employees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      Aucun compte E-user.
                    </TableCell>
                  </TableRow>
                ) : (
                  employees.map((employee) => {
                    const isPasswordVisible = visiblePasswordIds.has(employee.id);
                    const displayPassword =
                      employee.displayPassword && employee.displayPassword.length > 0
                        ? employee.displayPassword
                        : null;

                    return (
                      <TableRow key={employee.id}>
                        <TableCell className="font-medium">{employee.name}</TableCell>
                        <TableCell>{employee.email}</TableCell>
                        <TableCell>
                          {formatTunisianPhoneForDisplay(employee.phone ?? "") || "\u2014"}
                        </TableCell>
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
                            <Popover
                              open={isPasswordVisible}
                              onOpenChange={(open) => setPasswordVisibility(employee.id, open)}
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 w-8 cursor-pointer p-0"
                                  aria-label={
                                    isPasswordVisible
                                      ? "Masquer le mot de passe"
                                      : "Afficher le mot de passe"
                                  }
                                >
                                  {isPasswordVisible ? (
                                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                                  ) : (
                                    <Eye className="h-4 w-4" aria-hidden="true" />
                                  )}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                align="end"
                                side="top"
                                className="w-72 p-3 text-left text-xs"
                              >
                                <p className="font-medium text-foreground">Mot de passe</p>
                                {displayPassword ? (
                                  <div className="mt-2 inline-flex max-w-full rounded-md border bg-muted px-2 py-1 font-mono text-xs text-foreground">
                                    <span className="truncate">{displayPassword}</span>
                                  </div>
                                ) : (
                                  <p className="mt-1 text-muted-foreground">
                                    {PASSWORD_UNAVAILABLE_MESSAGE}
                                  </p>
                                )}
                              </PopoverContent>
                            </Popover>
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
                    );
                  })
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
              <Label htmlFor="employee-phone">{"Num\u00e9ro de t\u00e9l\u00e9phone"}</Label>
              <TunisianPhoneInput
                id="employee-phone"
                value={phone}
                onChange={(nextPhone) => {
                  setPhone(nextPhone);
                  setPhoneError(null);
                }}
                disabled={submitting || employeeLimitReached}
              />
              {phoneError ? <p className="text-xs text-destructive">{phoneError}</p> : null}
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
