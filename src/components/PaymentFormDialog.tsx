import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Clock } from "lucide-react";
import { toast } from "sonner";
import { schedulePaymentNotifications } from "@/services/notificationDeliveryScheduler";
import { readNotificationDeliveryMode } from "@/infrastructure/local/adminSettingsState";
import { createPayment, getAdminSettings, getPaymentSelectableClients } from "@/lib/data";
import { DatePickerInput } from "@/components/DatePickerInput";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const TIME_HOURS = Array.from({ length: 12 }, (_, index) => index + 1);
const TIME_MINUTES = Array.from({ length: 60 }, (_, index) =>
  String(index).padStart(2, "0"),
);
const TIME_PERIODS = ["AM", "PM"] as const;
const TIME_VALUE_PATTERN = /^(\d{2}):(\d{2})$/;
const TIME_DRAFT_PATTERN = /^(\d{0,4}|\d{0,2}:\d{0,2})$/;

type TimePeriod = (typeof TIME_PERIODS)[number];

function normalizeTimeInput(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "";
  }

  let hourText = "";
  let minuteText = "";

  if (/^\d{1,4}$/.test(trimmedValue)) {
    if (trimmedValue.length <= 2) {
      hourText = trimmedValue;
      minuteText = "00";
    } else {
      hourText = trimmedValue.slice(0, -2);
      minuteText = trimmedValue.slice(-2);
    }
  } else {
    const parts = /^(\d{1,2}):(\d{1,2})$/.exec(trimmedValue);

    if (!parts) {
      return null;
    }

    hourText = parts[1];
    minuteText = parts[2];
  }

  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getTimeParts(value: string) {
  const match = TIME_VALUE_PATTERN.exec(value);
  const now = new Date();
  let hour24 = now.getHours();
  let minute = String(now.getMinutes()).padStart(2, "0");

  if (match) {
    const parsedHour = Number(match[1]);
    const parsedMinute = Number(match[2]);

    if (parsedHour >= 0 && parsedHour <= 23 && parsedMinute >= 0 && parsedMinute <= 59) {
      hour24 = parsedHour;
      minute = match[2];
    }
  }

  const period: TimePeriod = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;

  return { hour12, minute, period };
}

function buildTimeValue(hour12: number, minute: string, period: TimePeriod) {
  const normalizedHour = hour12 % 12;
  const hour24 = period === "PM" ? normalizedHour + 12 : normalizedHour;

  return `${String(hour24).padStart(2, "0")}:${minute}`;
}

function TimePickerInput({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousValidValueRef = useRef(normalizeTimeInput(value) || "");
  const [isOpen, setIsOpen] = useState(false);
  const normalizedValue = normalizeTimeInput(value);
  const selectedTime = getTimeParts(normalizedValue || previousValidValueRef.current);

  useEffect(() => {
    const normalizedTime = normalizeTimeInput(value);

    if (normalizedTime) {
      previousValidValueRef.current = normalizedTime;
    }
  }, [value]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target;

      if (target instanceof Node && wrapperRef.current?.contains(target)) {
        return;
      }

      setIsOpen(false);
    };
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeydown, true);

    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeydown, true);
    };
  }, [isOpen]);

  const openPanel = () => {
    setIsOpen(true);
    inputRef.current?.focus();
  };

  const togglePanel = () => {
    setIsOpen((currentValue) => !currentValue);
    inputRef.current?.focus();
  };

  const selectHour = (hour12: number) => {
    const nextValue = buildTimeValue(hour12, selectedTime.minute, selectedTime.period);

    previousValidValueRef.current = nextValue;
    onChange(nextValue);
  };

  const selectMinute = (minute: string) => {
    const nextValue = buildTimeValue(selectedTime.hour12, minute, selectedTime.period);

    previousValidValueRef.current = nextValue;
    onChange(nextValue);
  };

  const selectPeriod = (period: TimePeriod) => {
    const nextValue = buildTimeValue(selectedTime.hour12, selectedTime.minute, period);

    previousValidValueRef.current = nextValue;
    onChange(nextValue);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value.trim();

    if (TIME_DRAFT_PATTERN.test(nextValue)) {
      onChange(nextValue);
    }
  };

  const handleInputBlur = () => {
    const normalizedTime = normalizeTimeInput(value);

    if (normalizedTime !== null) {
      onChange(normalizedTime);

      if (normalizedTime) {
        previousValidValueRef.current = normalizedTime;
      }

      return;
    }

    onChange(previousValidValueRef.current);
  };

  return (
    <div ref={wrapperRef} className={cn("payment-time-picker", isOpen && "is-open")}>
      <Input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={value}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className="payment-time-picker__input"
        onChange={handleInputChange}
        onBlur={handleInputBlur}
        onClick={openPanel}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPanel();
          }
        }}
      />
      <button
        type="button"
        className="swb-date-picker__toggle"
        aria-label="Choisir une heure"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={(event) => {
          event.preventDefault();
          togglePanel();
        }}
      >
        <Clock className="swb-date-picker__toggle-icon" aria-hidden="true" />
      </button>
      {isOpen ? (
        <div
          className="swb-date-picker__panel payment-time-picker__panel"
          role="dialog"
          aria-label="Choisir une heure"
        >
          <div className="payment-time-picker__columns">
            <div className="payment-time-picker__column">
              <div className="payment-time-picker__column-title">Heure</div>
              <div className="payment-time-picker__options">
                {TIME_HOURS.map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    className={cn(
                      "swb-date-picker__day payment-time-picker__option",
                      selectedTime.hour12 === hour && "is-selected",
                    )}
                    aria-pressed={selectedTime.hour12 === hour}
                    onClick={() => selectHour(hour)}
                  >
                    {String(hour).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </div>

            <div className="payment-time-picker__column">
              <div className="payment-time-picker__column-title">Minute</div>
              <div className="payment-time-picker__options">
                {TIME_MINUTES.map((minute) => (
                  <button
                    key={minute}
                    type="button"
                    className={cn(
                      "swb-date-picker__day payment-time-picker__option",
                      selectedTime.minute === minute && "is-selected",
                    )}
                    aria-pressed={selectedTime.minute === minute}
                    onClick={() => selectMinute(minute)}
                  >
                    {minute}
                  </button>
                ))}
              </div>
            </div>

            <div className="payment-time-picker__column">
              <div className="payment-time-picker__column-title">AM/PM</div>
              <div className="payment-time-picker__options payment-time-picker__options--period">
                {TIME_PERIODS.map((period) => (
                  <button
                    key={period}
                    type="button"
                    className={cn(
                      "swb-date-picker__day payment-time-picker__option",
                      selectedTime.period === period && "is-selected",
                    )}
                    aria-pressed={selectedTime.period === period}
                    onClick={() => selectPeriod(period)}
                  >
                    {period}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PaymentFormDialog({
  open,
  onOpenChange,
  presetClientId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  presetClientId?: string;
}) {
  const clients = getPaymentSelectableClients();
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
        readNotificationDeliveryMode(settings.notification_delivery_mode, settings.server_mode) ===
        "desktop-email";

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
      toast.error(error instanceof Error ? error.message : "Impossible d'enregistrer le paiement.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[720px]">
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
            {clients.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Aucun client disponible. Veuillez ajouter ou synchroniser un client avant
                d’enregistrer un paiement.
              </p>
            ) : null}
            {errors.clientId ? <p className="text-xs text-destructive">{errors.clientId}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label>Montant payé (TND) *</Label>
            <Input
              type="number"
              step="0.001"
              value={montant}
              onChange={(event) => setMontant(event.target.value)}
            />
            {errors.montant ? <p className="text-xs text-destructive">{errors.montant}</p> : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date *</Label>
              <DatePickerInput value={date} onChange={setDate} />
              {errors.date ? <p className="text-xs text-destructive">{errors.date}</p> : null}
            </div>

            <div className="space-y-1.5">
              <Label>Heure *</Label>
              <TimePickerInput value={heure} onChange={setHeure} />
              {errors.heure ? <p className="text-xs text-destructive">{errors.heure}</p> : null}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
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
