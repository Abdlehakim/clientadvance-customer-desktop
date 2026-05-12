import { AdminSettingsFormCard } from "@/components/AdminSettingsFormCard";
import { DatabaseLocationCard } from "@/components/DatabaseLocationCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AdminSettings } from "@/domain/types";

interface InitialAdminSetupDialogProps {
  open: boolean;
  settings: AdminSettings;
  onCompleted: () => void;
}

export function InitialAdminSetupDialog({
  open,
  settings,
  onCompleted,
}: InitialAdminSetupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        className="max-h-[90vh] max-w-6xl overflow-y-auto"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Configuration initiale</DialogTitle>
          <DialogDescription>
            Avant de commencer, configurez les paramètres essentiels de
            l'application.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <AdminSettingsFormCard
            settings={settings}
            submitLabel="Enregistrer et commencer"
            successMessage="Configuration enregistrée avec succès"
            showSyncBadge={false}
            extraPatch={{ setup_completed: true }}
            onSaved={onCompleted}
          />
          <DatabaseLocationCard className="h-fit" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
