import { Badge } from "@/components/ui/badge";
import type {
  LocalPaymentSyncDisplayStatus,
  ServerPaymentSyncDisplayStatus,
} from "@/services/appServices";
import { cn } from "@/lib/utils";

type PaymentSyncDisplayStatus =
  | LocalPaymentSyncDisplayStatus
  | ServerPaymentSyncDisplayStatus;

const STATUS_MAP: Record<PaymentSyncDisplayStatus, { label: string; className: string }> = {
  "saved-local": {
    label: "Enregistr\u00e9 localement",
    className: "bg-success/15 text-[oklch(0.35_0.1_150)] border-success/30",
  },
  "failed-local": {
    label: "\u00c9chec local",
    className: "bg-destructive/15 text-destructive border-destructive/30",
  },
  synced: {
    label: "Synchronis\u00e9",
    className: "bg-success/15 text-[oklch(0.35_0.1_150)] border-success/30",
  },
  pending: {
    label: "En attente",
    className: "bg-warning/15 text-warning-foreground border-warning/30",
  },
  failed: {
    label: "\u00c9chec",
    className: "bg-destructive/15 text-destructive border-destructive/30",
  },
  "not-applicable": {
    label: "Non applicable",
    className: "bg-muted text-muted-foreground border-border",
  },
};

export function PaymentSyncStatusBadge({
  status,
}: {
  status: PaymentSyncDisplayStatus;
}) {
  const metadata = STATUS_MAP[status];

  return (
    <Badge variant="outline" className={cn("font-medium whitespace-nowrap", metadata.className)}>
      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {metadata.label}
    </Badge>
  );
}
