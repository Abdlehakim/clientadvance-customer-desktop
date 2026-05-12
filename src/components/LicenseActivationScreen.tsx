import { useState } from "react";
import type { FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LicenseActivationScreenProps {
  isActivating: boolean;
  isOnline: boolean;
  message: string;
  onActivate: (input: { licenseKey: string; customerName?: string }) => Promise<void>;
}

export function LicenseActivationScreen({
  isActivating,
  isOnline,
  message,
  onActivate,
}: LicenseActivationScreenProps) {
  const [licenseKey, setLicenseKey] = useState("");
  const [customerName, setCustomerName] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onActivate({
      licenseKey,
      customerName,
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-accent p-4">
      <Card className="w-full max-w-lg p-8 shadow-elevated">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Activation de la licence</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Activation requise. Veuillez saisir une clé de licence valide.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="license-key">Clé de licence</Label>
            <Input
              id="license-key"
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
              placeholder="Entrez votre clé de licence"
              disabled={isActivating}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="customer-name">Nom de l’entreprise</Label>
            <Input
              id="customer-name"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              placeholder="Optionnel"
              disabled={isActivating}
            />
          </div>

          {message && (
            <div className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm text-foreground">
              {message}
            </div>
          )}

          {!isOnline && (
            <div className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
              Une connexion Internet est requise pour une nouvelle activation.
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isActivating}>
            {isActivating ? "Activation..." : "Activer la licence"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
