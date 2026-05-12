import { useEffect, useState } from "react";
import { toast } from "sonner";
import { schedulePaymentNotifications } from "@/services/notificationDeliveryScheduler";
import { readNotificationDeliveryMode } from "@/infrastructure/local/adminSettingsState";
import { createPayment, getAdminSettings, getClients } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PaymentFormDialog({
  open,
  onOpenChange,
  presetClientId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  presetClientId?: string;
}) {
  const clients = getClients();
  const [clientId, setClientId] = useState("");
  const [montant, setMontant] = useState("");
  const [date, setDate] = useState("");
  const [heure, setHeure] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const now = new Date();
    setClientId(presetClientId ?? "");
    setMontant("");
    setDate(now.toISOString().slice(0, 10));
    setHeure(now.toTimeString().slice(0, 5));
    setErrors({});
    setIsSubmitting(false);
  }, [open, presetClientId]);

  const submit = async () => {
    const nextErrors: Record<string, string> = {};

    if (!clientId) {
      nextErrors.clientId = "Client requis";
    }

    const parsedAmount = parseFloat(montant);

    if (!montant || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      nextErrors.montant = "Montant invalide";
    }

    if (!date) {
      nextErrors.date = "Date requise";
    }

    if (!heure) {
      nextErrors.heure = "Heure requise";
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);

    try {
      const settings = getAdminSettings();
      const shouldUseDesktopEmail =
        readNotificationDeliveryMode(
          settings.notification_delivery_mode,
          settings.server_mode,
        ) === "desktop-email";
      const payment = await createPayment({
        client_id: clientId,
        montant: parsedAmount,
        date_paiement: date,
        heure_paiement: heure,
      });

      toast.success("Paiement enregistré avec succès.");
      onOpenChange(false);

      if (shouldUseDesktopEmail) {
        schedulePaymentNotifications(payment.id);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Impossible d'enregistrer le paiement.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Ajouter un paiement</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Client *</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un client" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.nom_complet}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.clientId ? (
              <p className="text-xs text-destructive">{errors.clientId}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label>Montant payé (TND) *</Label>
            <Input
              type="number"
              step="0.001"
              value={montant}
              onChange={(event) => setMontant(event.target.value)}
            />
            {errors.montant ? (
              <p className="text-xs text-destructive">{errors.montant}</p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date *</Label>
              <Input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
              {errors.date ? (
                <p className="text-xs text-destructive">{errors.date}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label>Heure *</Label>
              <Input
                type="time"
                value={heure}
                onChange={(event) => setHeure(event.target.value)}
              />
              {errors.heure ? (
                <p className="text-xs text-destructive">{errors.heure}</p>
              ) : null}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Annuler
          </Button>
          <Button onClick={() => void submit()} disabled={isSubmitting}>
            {isSubmitting ? "Enregistrement..." : "Enregistrer le paiement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
