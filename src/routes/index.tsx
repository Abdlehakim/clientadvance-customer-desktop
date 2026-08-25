import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { invokeTauriCommand } from "@/infrastructure/local/sqlite/sqliteClient";
import { getCurrentUser, login, seedIfNeeded } from "@/lib/data";
import { initializeStorageDriver } from "@/services/appServices";

const LOGIN_ERROR_MESSAGE = "Identifiants incorrects ou serveur indisponible.";

export const Route = createFileRoute("/")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [openerError, setOpenerError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOpeningSignup, setIsOpeningSignup] = useState(false);

  useEffect(() => {
    seedIfNeeded();

    void initializeStorageDriver()
      .catch((storageError) => {
        console.error("Local auth initialization failed.", storageError);
      })
      .then(() => {
        if (getCurrentUser()) {
          navigate({ to: "/dashboard", replace: true });
        }
      });
  }, [navigate]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const user = await Promise.resolve(login(identifier.trim(), password));

      if (!user) {
        setError(LOGIN_ERROR_MESSAGE);
        return;
      }

      navigate({ to: "/dashboard" });
    } catch {
      setError(LOGIN_ERROR_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openTrialSignup = async () => {
    setOpenerError("");
    setIsOpeningSignup(true);

    try {
      await invokeTauriCommand<void>("open_trial_signup_page");
    } catch {
      setOpenerError("Impossible d’ouvrir la page d’inscription.");
    } finally {
      setIsOpeningSignup(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-accent p-4">
      <Card className="w-full max-w-md p-8 shadow-elevated">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">ClientAdvans</h1>
          <p className="mt-1 text-sm text-muted-foreground">Connectez-vous a votre espace</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="identifier">
              Numéro de téléphone / identifiant E-user
            </Label>
            <Input
              id="identifier"
              type="text"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="Numéro administrateur ou identifiant E-user"
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Connexion..." : "Se connecter"}
          </Button>

          <div className="space-y-2 border-t pt-4 text-center">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={openTrialSignup}
              disabled={isSubmitting || isOpeningSignup}
            >
              Créer un compte d’essai gratuit
            </Button>
            <p className="text-xs text-muted-foreground">3 jours gratuits</p>
            {openerError ? (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {openerError}
              </div>
            ) : null}
          </div>
        </form>
      </Card>
    </div>
  );
}
