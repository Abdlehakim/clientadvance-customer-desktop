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
  getLocalDatabaseLocation,
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

export function DatabaseLocationCard({
  className,
  actionButtonClassName,
  actionButtonVariant,
  description = "Ouvrir l'emplacement du fichier de base de données SQLite utilisé par l'application.",
  onLocationChange,
}: DatabaseLocationCardProps) {
  const isDesktopApp = isTauriRuntime();
  const [databaseLocation, setDatabaseLocation] = useState<SqliteDatabaseInfo | null>(null);
  const [isOpeningDatabaseLocation, setIsOpeningDatabaseLocation] = useState(false);
  const [isChangingDatabaseLocation, setIsChangingDatabaseLocation] = useState(false);

  useEffect(() => {
    if (!isDesktopApp) {
      setDatabaseLocation(null);
      onLocationChange?.(null);
      return;
    }

    let cancelled = false;

    void getLocalDatabaseLocation()
      .then((location) => {
        if (!cancelled) {
          setDatabaseLocation(location);
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
      setDatabaseLocation(location);
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

      setDatabaseLocation(result.location);
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

  return (
    <Card className={cn("p-6 shadow-card", className)}>
      <h3 className="font-semibold">Base de données locale</h3>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      {isDesktopApp ? (
        <div className="mt-4 space-y-1.5">
          <Label>Emplacement actuel</Label>
          <Input value={databaseLocation?.path ?? ""} readOnly />
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant={actionButtonVariant}
          className={actionButtonClassName}
          disabled={!isDesktopApp || isOpeningDatabaseLocation || isChangingDatabaseLocation}
          onClick={() => void handleOpenDatabaseLocation()}
        >
          {isOpeningDatabaseLocation ? "Ouverture..." : "Ouvrir le dossier"}
        </Button>
        <Button
          variant={actionButtonVariant}
          className={actionButtonClassName}
          disabled={!isDesktopApp || isOpeningDatabaseLocation || isChangingDatabaseLocation}
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
