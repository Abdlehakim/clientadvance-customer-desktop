import { Badge } from "@/components/ui/badge";
import type { PaymentNotificationDisplayStatus } from "@/services/paymentNotificationService";
import { cn } from "@/lib/utils";

const STATUS_MAP: Record<
  PaymentNotificationDisplayStatus,
  { label: string; className: string }
> = {
  sent: {
    label: "Envoy\u00e9",
    className: "bg-success/15 text-[oklch(0.35_0.1_150)] border-success/30",
  },
  queued: {
    label: "En attente",
    className: "bg-warning/15 text-warning-foreground border-warning/30",
  },
  sending: {
    label: "En cours",
    className: "bg-info/10 text-info border-info/30",
  },
  failed: {
    label: "\u00c9chec",
    className: "bg-destructive/15 text-destructive border-destructive/30",
  },
  "not-created": {
    label: "Non cr\u00e9\u00e9",
    className: "bg-muted text-muted-foreground border-border",
  },
  "not-applicable": {
    label: "Non applicable",
    className: "bg-muted text-muted-foreground border-border",
  },
};

export function PaymentNotificationStatusBadge({
  status,
}: {
  status: PaymentNotificationDisplayStatus;
}) {
  const metadata = STATUS_MAP[status];

  return (
    <Badge variant="outline" className={cn("font-medium whitespace-nowrap", metadata.className)}>
      {metadata.label}
    </Badge>
  );
}
