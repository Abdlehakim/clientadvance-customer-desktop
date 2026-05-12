import { Badge } from "@/components/ui/badge";
import type { SyncStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const map: Record<SyncStatus, { label: string; cls: string }> = {
  local: { label: "Local", cls: "bg-muted text-muted-foreground border-border" },
  pending: { label: "En attente", cls: "bg-warning/15 text-warning-foreground border-warning/30" },
  synced: { label: "Synchronisé", cls: "bg-success/15 text-[oklch(0.35_0.1_150)] border-success/30" },
  failed: { label: "Échec", cls: "bg-destructive/15 text-destructive border-destructive/30" },
};

export function SyncBadge({ status }: { status: SyncStatus }) {
  const m = map[status];
  return (
    <Badge variant="outline" className={cn("font-medium", m.cls)}>
      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {m.label}
    </Badge>
  );
}
