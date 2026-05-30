import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeCurrentEmployeePassword, getCurrentUser } from "@/lib/data";
import { useAppData } from "@/lib/useAppData";
import { useHasMounted } from "@/hooks/useHasMounted";

export const Route = createFileRoute("/parametres-utilisateur")({
  component: UserSettingsPage,
});

const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_CHANGED_MESSAGE = "Mot de passe modifié avec succès.";
const UNAUTHORIZED_ACTION_MESSAGE =
  "Vous n'êtes pas autorisé à effectuer cette action.";

function getErrorMessage(error: unknown) {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message.trim()
      : "";

  if (/^(unauthorized|forbidden)$/i.test(message) || /API\s+40[13]/i.test(message)) {
    return UNAUTHORIZED_ACTION_MESSAGE;
  }

  return message || "Opération impossible.";
}

function UserSettingsPage() {
  useAppData();
  const mounted = useHasMounted();
  const user = mounted ? getCurrentUser() : null;
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!mounted) {
    return <div className="min-h-screen w-full bg-background" />;
  }

  if (user?.role !== "employe") {
    return (
      <AppLayout>
        <Card className="mx-auto max-w-lg p-8 text-center shadow-card">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <h2 className="text-lg font-semibold">Accès refusé</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cette section est réservée aux E-user.
          </p>
        </Card>
      </AppLayout>
    );
  }

  const validate = () => {
    if (currentPassword.length === 0) {
      return "Mot de passe actuel incorrect.";
    }

    if (newPassword.trim().length === 0) {
      return "Le nouveau mot de passe est obligatoire.";
    }

    if (newPassword.trim().length < PASSWORD_MIN_LENGTH) {
      return "Le nouveau mot de passe doit contenir au moins 6 caractères.";
    }

    if (newPassword.trim() !== confirmPassword.trim()) {
      return "Les mots de passe ne correspondent pas.";
    }

    return null;
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");

    const validationError = validate();

    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);

    try {
      await changeCurrentEmployeePassword({
        currentPassword,
        newPassword,
        confirmPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage(PASSWORD_CHANGED_MESSAGE);
      toast.success(PASSWORD_CHANGED_MESSAGE);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Paramètres</h1>
      </div>

      <Card className="max-w-5xl p-6 shadow-card">
        <div className="mb-5">
          <h2 className="text-lg font-semibold">Changer le mot de passe</h2>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[190px] flex-1 space-y-1.5">
              <Label htmlFor="current-password">Mot de passe actuel</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                disabled={submitting}
                autoComplete="current-password"
              />
            </div>

            <div className="min-w-[190px] flex-1 space-y-1.5">
              <Label htmlFor="new-password">Nouveau mot de passe</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                disabled={submitting}
                minLength={PASSWORD_MIN_LENGTH}
                autoComplete="new-password"
              />
            </div>

            <div className="min-w-[230px] flex-1 space-y-1.5">
              <Label htmlFor="confirm-password">Confirmer le nouveau mot de passe</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={submitting}
                minLength={PASSWORD_MIN_LENGTH}
                autoComplete="new-password"
              />
            </div>

            <Button type="submit" className="shrink-0" disabled={submitting}>
              {submitting ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </div>

          {error ? (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {message ? (
            <div className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm text-[oklch(0.35_0.1_150)]">
              <CheckCircle2 className="h-4 w-4" />
              {message}
            </div>
          ) : null}
        </form>
      </Card>
    </AppLayout>
  );
}
