import { useEffect, useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  isTauriRuntime,
  type SqliteDatabaseInfo,
} from "@/infrastructure/local/sqlite/sqliteClient";
import {
  changeLocalDatabaseLocation,
  chooseLocalDatabaseFolder,
  cleanupLegacyLocalStorageData,
  getLocalDatabaseLocation,
  getStorageDiagnostics,
  openLocalDatabaseLocation,
} from "@/lib/data";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface DatabaseLocationCardProps {
  className?: string;
  actionButtonClassName?: string;
  actionButtonVariant?: ButtonProps["variant"];
  description?: string;
  onLocationChange?: (location: SqliteDatabaseInfo | null) => void;
}

type StorageDiagnostics = Awaited<ReturnType<typeof getStorageDiagnostics>>;

export function DatabaseLocationCard({
  className,
  actionButtonClassName,
  actionButtonVariant,
  description = "Ouvrir l'emplacement du fichier de base de données SQLite utilisé par l'application.",
  onLocationChange,
}: DatabaseLocationCardProps) {
  const isDesktopApp = isTauriRuntime();
  const [databaseLocation, setDatabaseLocation] = useState<SqliteDatabaseInfo | null>(null);
  const [storageDiagnostics, setStorageDiagnostics] = useState<StorageDiagnostics | null>(null);
  const [isOpeningDatabaseLocation, setIsOpeningDatabaseLocation] = useState(false);
  const [isChangingDatabaseLocation, setIsChangingDatabaseLocation] = useState(false);
  const [isCleaningLegacyStorage, setIsCleaningLegacyStorage] = useState(false);

  const canCleanupLegacyStorage =
    isDesktopApp &&
    storageDiagnostics?.storageDriver === "sqlite" &&
    storageDiagnostics.migrationStatus?.status === "success" &&
    Boolean(storageDiagnostics.tableCounts) &&
    !isOpeningDatabaseLocation &&
    !isChangingDatabaseLocation &&
    !isCleaningLegacyStorage;

  useEffect(() => {
    if (!isDesktopApp) {
      setDatabaseLocation(null);
      onLocationChange?.(null);
      return;
    }

    let cancelled = false;

    void Promise.all([getLocalDatabaseLocation(), getStorageDiagnostics()])
      .then(([location, diagnostics]) => {
        if (!cancelled) {
          setDatabaseLocation(location);
          setStorageDiagnostics(diagnostics);
          onLocationChange?.(location);
        }
      })
      .catch((error) => {
        console.error("Failed to load database location.", error);
      });

    return () => {
      cancelled = true;
    };
  }, [isDesktopApp, onLocationChange]);

  const handleOpenDatabaseLocation = async () => {
    if (!isDesktopApp) {
      return;
    }

    setIsOpeningDatabaseLocation(true);

    try {
      const location = await openLocalDatabaseLocation();
      const diagnostics = await getStorageDiagnostics();
      setDatabaseLocation(location);
      setStorageDiagnostics(diagnostics);
      onLocationChange?.(location);
    } catch {
      toast.error("Impossible d'ouvrir l'emplacement de la base de données.");
    } finally {
      setIsOpeningDatabaseLocation(false);
    }
  };

  const handleChangeDatabaseLocation = async () => {
    if (!isDesktopApp) {
      return;
    }

    setIsChangingDatabaseLocation(true);

    try {
      const folderPath = await chooseLocalDatabaseFolder();

      if (!folderPath) {
        return;
      }

      let result = await changeLocalDatabaseLocation(folderPath);

      if (result.requiresConfirmation) {
        const confirmed = window.confirm(
          "Un fichier de base de données existe déjà dans ce dossier. Voulez-vous le remplacer ?",
        );

        if (!confirmed) {
          return;
        }

        result = await changeLocalDatabaseLocation(folderPath, true);
      }

      if (result.requiresConfirmation) {
        throw new Error("Database replacement confirmation did not resolve.");
      }

      const diagnostics = await getStorageDiagnostics();
      setDatabaseLocation(result.location);
      setStorageDiagnostics(diagnostics);
      onLocationChange?.(result.location);
      toast.success(
        "Emplacement de la base de données modifié avec succès. Redémarrez l'application pour appliquer complètement le changement.",
      );
    } catch {
      toast.error("Impossible de modifier l'emplacement de la base de données.");
    } finally {
      setIsChangingDatabaseLocation(false);
    }
  };

  const handleCleanupLegacyStorage = async () => {
    if (!canCleanupLegacyStorage) {
      return;
    }

    const confirmed = window.confirm(
      "La migration SQLite est terminée. Voulez-vous supprimer les anciennes données localStorage ? Cette action ne supprimera pas les données SQLite.",
    );

    if (!confirmed) {
      return;
    }

    setIsCleaningLegacyStorage(true);

    try {
      await cleanupLegacyLocalStorageData();
      const diagnostics = await getStorageDiagnostics();
      setStorageDiagnostics(diagnostics);
      toast.success("Anciennes données localStorage supprimées avec succès.");
    } catch (error) {
      toast.error(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Impossible de supprimer les anciennes données localStorage.",
      );
    } finally {
      setIsCleaningLegacyStorage(false);
    }
  };

  return (
    <Card className={cn("p-6 shadow-card", className)}>
      <h3 className="font-semibold">Base de données locale</h3>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      {isDesktopApp ? (
        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label>Emplacement actuel</Label>
            <Input value={databaseLocation?.path ?? ""} readOnly />
          </div>
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>
                Mode actif :{" "}
                <strong>{storageDiagnostics?.storageDriver ?? "sqlite"}</strong>
              </span>
              <span>
                Migration :{" "}
                <strong>{storageDiagnostics?.migrationStatus?.status ?? "non verifiee"}</strong>
              </span>
            </div>
            {storageDiagnostics?.migrationStatus?.backupPath ? (
              <p className="mt-2 text-muted-foreground">
                Sauvegarde avant import : {storageDiagnostics.migrationStatus.backupPath}
              </p>
            ) : null}
            {storageDiagnostics?.tableCounts ? (
              <div className="mt-3 grid gap-1 sm:grid-cols-2">
                {Object.entries(storageDiagnostics.tableCounts).map(([tableName, count]) => (
                  <span key={tableName} className="text-muted-foreground">
                    {tableName}: <strong className="text-foreground">{count}</strong>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {storageDiagnostics?.localStorageBusinessDataDetected ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p>
                Anciennes donnees localStorage detectees :{" "}
                {storageDiagnostics.localStorageBusinessDataKeys.join(", ")}. SQLite reste la
                source active.
              </p>
              <Button
                variant={actionButtonVariant}
                className={cn("mt-3", actionButtonClassName)}
                disabled={!canCleanupLegacyStorage}
                onClick={() => void handleCleanupLegacyStorage()}
              >
                {isCleaningLegacyStorage
                  ? "Nettoyage..."
                  : "Nettoyer les anciennes données localStorage"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant={actionButtonVariant}
          className={actionButtonClassName}
          disabled={
            !isDesktopApp ||
            isOpeningDatabaseLocation ||
            isChangingDatabaseLocation ||
            isCleaningLegacyStorage
          }
          onClick={() => void handleOpenDatabaseLocation()}
        >
          {isOpeningDatabaseLocation ? "Ouverture..." : "Ouvrir le dossier"}
        </Button>
        <Button
          variant={actionButtonVariant}
          className={actionButtonClassName}
          disabled={
            !isDesktopApp ||
            isOpeningDatabaseLocation ||
            isChangingDatabaseLocation ||
            isCleaningLegacyStorage
          }
          onClick={() => void handleChangeDatabaseLocation()}
        >
          {isChangingDatabaseLocation ? "Modification..." : "Modifier l’emplacement"}
        </Button>
      </div>
      {!isDesktopApp ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Cette option est disponible uniquement dans l'application desktop.
        </p>
      ) : null}
    </Card>
  );
}
