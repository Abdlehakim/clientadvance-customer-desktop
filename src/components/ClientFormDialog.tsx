import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DatePickerInput } from "@/components/DatePickerInput";
import { TunisianPhoneInput } from "@/components/TunisianPhoneInput";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient, updateClient } from "@/lib/data";
import type { Client } from "@/lib/types";
import {
  TUNISIAN_PHONE_VALIDATION_MESSAGE,
  formatTunisianLocalPhone,
  isValidTunisianPhone,
  normalizeTunisianPhone,
} from "@/lib/tunisianPhone";

const emptyForm = {
  nom_complet: "",
  telephone: "",
  adresse: "",
  email: "",
  cin: "",
  cinIssuedAt: "",
  birthDate: "",
};

export function ClientFormDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  client?: Client | null;
}) {
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      return;
    }

    setErrors({});
    setForm(
      client
        ? {
            nom_complet: client.nom_complet,
            telephone: formatTunisianLocalPhone(client.telephone),
            adresse: client.adresse,
            email: client.email,
            cin: client.cin,
            cinIssuedAt: client.cinIssuedAt ?? "",
            birthDate: client.birthDate ?? "",
          }
        : emptyForm,
    );
  }, [client, open]);

  const submit = () => {
    const nextErrors: Record<string, string> = {};

    if (!form.nom_complet.trim()) {
      nextErrors.nom_complet = "Nom complet requis";
    }

    if (!form.telephone.trim()) {
      nextErrors.telephone = "T\u00e9l\u00e9phone requis";
    } else if (!isValidTunisianPhone(form.telephone)) {
      nextErrors.telephone = TUNISIAN_PHONE_VALIDATION_MESSAGE;
    }

    if (form.cin && !/^\d+$/.test(form.cin)) {
      nextErrors.cin = "Le CIN doit \u00eatre num\u00e9rique";
    }

    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      nextErrors.email = "Email invalide";
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const payload = {
      ...form,
      telephone: normalizeTunisianPhone(form.telephone),
    };

    if (client) {
      updateClient(client.id, payload);
      toast.success("Client modifi\u00e9");
    } else {
      createClient(payload);
      toast.success("Client ajout\u00e9");
    }

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{client ? "Modifier le client" : "Ajouter un client"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2 sm:grid-cols-2 sm:gap-x-3">
          <div className="space-y-1.5">
            <Label htmlFor="nom_complet">Nom complet *</Label>
            <Input
              id="nom_complet"
              value={form.nom_complet}
              onChange={(event) =>
                setForm((current) => ({ ...current, nom_complet: event.target.value }))
              }
            />
            {errors.nom_complet ? (
              <p className="text-xs text-destructive">{errors.nom_complet}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="birthDate">Date de naissance</Label>
            <DatePickerInput
              id="birthDate"
              value={form.birthDate}
              onChange={(birthDate) => setForm((current) => ({ ...current, birthDate }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="telephone">{"Num\u00e9ro de t\u00e9l\u00e9phone *"}</Label>
            <TunisianPhoneInput
              id="telephone"
              value={form.telephone}
              onChange={(telephone) => setForm((current) => ({ ...current, telephone }))}
            />
            {errors.telephone ? (
              <p className="text-xs text-destructive">{errors.telephone}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adresse">Adresse</Label>
            <Input
              id="adresse"
              value={form.adresse}
              onChange={(event) =>
                setForm((current) => ({ ...current, adresse: event.target.value }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              value={form.email}
              onChange={(event) =>
                setForm((current) => ({ ...current, email: event.target.value }))
              }
            />
            {errors.email ? <p className="text-xs text-destructive">{errors.email}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cin">{"Num\u00e9ro CIN"}</Label>
            <Input
              id="cin"
              value={form.cin}
              onChange={(event) => setForm((current) => ({ ...current, cin: event.target.value }))}
            />
            {errors.cin ? <p className="text-xs text-destructive">{errors.cin}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cinIssuedAt">CIN délivrée le</Label>
            <DatePickerInput
              id="cinIssuedAt"
              value={form.cinIssuedAt}
              onChange={(cinIssuedAt) => setForm((current) => ({ ...current, cinIssuedAt }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={submit}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
