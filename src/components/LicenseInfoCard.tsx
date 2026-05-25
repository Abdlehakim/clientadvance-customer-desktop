import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { NormalizedLicenseState } from "@/domain/types";
import {
  clearLicenseState,
  formatDateTimeFR,
  getLicenseAccessSnapshot,
  getLicenseAppVersion,
  getLicenseState,
  refreshLicenseState,
} from "@/lib/data";
import type { LicenseAccessSnapshot } from "@/services/licenseService";

const IS_DEV = import.meta.env.DEV;
const LOCAL_LICENSE_REFRESH_SUCCESS_MESSAGE = "Vérification locale effectuée.";
const LOCAL_LICENSE_DEACTIVATE_SUCCESS_MESSAGE =
  "Licence désactivée sur cet appareil.";
const LOCAL_LICENSE_DEACTIVATE_CONFIRMATION =
  "Cette action supprimera l’activation locale de cet appareil. Vous devrez réactiver la licence pour utiliser l’application.";
const LICENSE_INFO_UNAVAILABLE_MESSAGE = "Informations de licence indisponibles";
const LICENSE_ACTIVATED_FALLBACK_MESSAGE = "Licence activée";

interface LicenseInfoState {
  snapshot: LicenseAccessSnapshot | null;
  licenseState: NormalizedLicenseState | null;
  errorMessage: string | null;
}

function createInitialLicenseInfoState(): LicenseInfoState {
  return {
    snapshot: null,
    licenseState: null,
    errorMessage: null,
  };
}

function formatLicenseDateTime(value: string | null | undefined) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "—";
  }

  const { date, time } = formatDateTimeFR(value);
  return `${date} ${time}`;
}

function formatExpiration(value: string | null | undefined) {
  if (value === null) {
    return "Aucune expiration";
  }

  return formatLicenseDateTime(value);
}

function getStatusLabel(snapshot: LicenseAccessSnapshot | null) {
  if (!snapshot) {
    return "Informations de licence indisponibles";
  }

  if (snapshot.status === "active" || snapshot.status === "dev-bypass") {
    return "Active";
  }

  if (snapshot.status === "expired") {
    return "Expirée";
  }

  if (snapshot.status === "revoked") {
    return "Révoquée";
  }

  if (snapshot.status === "suspended") {
    return "Suspendue";
  }

  if (snapshot.status === "invalid") {
    return "Invalide";
  }

  return "Licence non activée";
}

function getStatusClassName(snapshot: LicenseAccessSnapshot | null) {
  if (!snapshot) {
    return "border-border bg-muted text-muted-foreground";
  }

  if (snapshot.status === "active" || snapshot.status === "dev-bypass") {
    return "border-success/40 bg-success/10 text-[oklch(0.35_0.1_150)]";
  }

  if (
    snapshot.status === "expired" ||
    snapshot.status === "invalid" ||
    snapshot.status === "revoked" ||
    snapshot.status === "suspended"
  ) {
    return "border-destructive/40 bg-destructive/10 text-destructive";
  }

  return "border-border bg-muted text-muted-foreground";
}

function getOfflineAllowedLabel(snapshot: LicenseAccessSnapshot | null) {
  return snapshot?.status === "active" || snapshot?.status === "dev-bypass"
    ? "Oui"
    : "Non";
}

function getMaskedLicenseKey(
  state: NormalizedLicenseState | null,
  isDevBypass: boolean,
) {
  if (isDevBypass) {
    return "Bypass développement";
  }

  if (!state) {
    return "—";
  }

  if (state?.licenseKeyMasked) {
    return state.licenseKeyMasked;
  }

  return "Non disponible localement";
}

function getLicenseSummary(state: LicenseInfoState) {
  if (state.errorMessage) {
    return state.errorMessage;
  }

  if (state.snapshot?.status === "active" || state.snapshot?.status === "dev-bypass") {
    return state.snapshot.message ||
      (state.licenseState
        ? LICENSE_ACTIVATED_FALLBACK_MESSAGE
        : LICENSE_INFO_UNAVAILABLE_MESSAGE);
  }

  if (state.snapshot?.message) {
    return state.snapshot.message;
  }

  if (state.snapshot?.status === "missing") {
    return "Licence non activée";
  }

  return LICENSE_INFO_UNAVAILABLE_MESSAGE;
}

function LicenseInfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b pb-3 last:border-b-0 last:pb-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

interface LicenseInfoCardProps {
  actionButtonClassName?: string;
}

export function LicenseInfoCard({ actionButtonClassName }: LicenseInfoCardProps = {}) {
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfoState>(
    createInitialLicenseInfoState(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const appVersion = getLicenseAppVersion();
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadLicenseInfo = async () => {
      setIsLoading(true);

      try {
        const [snapshot, licenseState] = await Promise.all([
          getLicenseAccessSnapshot(),
          getLicenseState(),
        ]);

        if (cancelled || !isMountedRef.current) {
          return;
        }

        setLicenseInfo({
          snapshot,
          licenseState,
          errorMessage: null,
        });
      } catch (error) {
        if (IS_DEV) {
          console.error("[license] failed to load license card", error);
        }

        if (cancelled || !isMountedRef.current) {
          return;
        }

        setLicenseInfo({
          snapshot: null,
          licenseState: null,
          errorMessage: LICENSE_INFO_UNAVAILABLE_MESSAGE,
        });
      } finally {
        if (!cancelled && isMountedRef.current) {
          setIsLoading(false);
        }
      }
    };

    void loadLicenseInfo();

    return () => {
      cancelled = true;
    };
  }, []);

  const updateLicenseInfo = async (
    loader: "refresh" | "clear",
    action: () => Promise<LicenseAccessSnapshot>,
    successMessage: string,
  ) => {
    if (loader === "refresh") {
      setIsRefreshing(true);
    } else {
      setIsClearing(true);
    }

    try {
      const snapshot = await action();
      const licenseState = await getLicenseState();

      if (!isMountedRef.current) {
        return;
      }

      setLicenseInfo({
        snapshot,
        licenseState,
        errorMessage: null,
      });
      if (snapshot.requiresActivation) {
        toast.error(snapshot.message || LICENSE_INFO_UNAVAILABLE_MESSAGE);
      } else if (snapshot.offlineActive && snapshot.message.trim().length > 0) {
        toast(snapshot.message);
      } else {
        toast.success(successMessage);
      }
    } catch (error) {
      if (IS_DEV) {
        console.error(`[license] failed to ${loader === "refresh" ? "refresh" : "clear"} license card`, error);
      }

      if (!isMountedRef.current) {
        return;
      }

      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : LICENSE_INFO_UNAVAILABLE_MESSAGE;

      setLicenseInfo((current) => ({
        ...current,
        errorMessage: message,
      }));
      toast.error(message);
    } finally {
      if (!isMountedRef.current) {
        return;
      }

      if (loader === "refresh") {
        setIsRefreshing(false);
      } else {
        setIsClearing(false);
      }
    }
  };

  const onRefreshLicense = async () => {
    await updateLicenseInfo(
      "refresh",
      () => refreshLicenseState(),
      LOCAL_LICENSE_REFRESH_SUCCESS_MESSAGE,
    );
  };

  const onDeactivateLicense = async () => {
    if (!window.confirm(LOCAL_LICENSE_DEACTIVATE_CONFIRMATION)) {
      return;
    }

    await updateLicenseInfo(
      "clear",
      async () => {
        await clearLicenseState();
        return refreshLicenseState();
      },
      LOCAL_LICENSE_DEACTIVATE_SUCCESS_MESSAGE,
    );
  };

  const snapshot = licenseInfo.snapshot;
  const state = licenseInfo.licenseState;
  const canDeactivate = Boolean(state || snapshot?.state) && !snapshot?.isDevBypass;

  return (
    <Card className="p-6 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Licence de l’application</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Consultez l’état local de la licence activée sur cet appareil.
          </p>
        </div>
        <Badge variant="outline" className={getStatusClassName(snapshot)}>
          {getStatusLabel(snapshot)}
        </Badge>
      </div>

      {isLoading ? (
        <div className="mt-4 text-sm text-muted-foreground">Chargement...</div>
      ) : (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            {getLicenseSummary(licenseInfo)}
          </p>

          <dl className="mt-4 space-y-3 text-sm">
            <LicenseInfoRow
              label="Statut de la licence"
              value={getStatusLabel(snapshot)}
            />
            <LicenseInfoRow
              label="Nom de l’entreprise"
              value={state?.customerName ?? "—"}
            />
            <LicenseInfoRow
              label="Activée le"
              value={formatLicenseDateTime(state?.activatedAt)}
            />
            <LicenseInfoRow
              label="Expire le"
              value={state ? formatExpiration(state.expiresAt) : "—"}
            />
            <LicenseInfoRow
              label="Dernière vérification"
              value={formatLicenseDateTime(state?.lastCheckedAt)}
            />
            <LicenseInfoRow
              label="Mode hors ligne autorisé"
              value={getOfflineAllowedLabel(snapshot)}
            />
            <LicenseInfoRow
              label="Clé de licence"
              value={getMaskedLicenseKey(state, Boolean(snapshot?.isDevBypass))}
            />
            {appVersion ? (
              <LicenseInfoRow
                label="Version de l’application"
                value={appVersion}
              />
            ) : null}
          </dl>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className={actionButtonClassName}
              onClick={() => void onRefreshLicense()}
              disabled={isRefreshing || isClearing}
            >
              {isRefreshing ? "Vérification..." : "Vérifier la licence"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className={actionButtonClassName}
              onClick={() => void onDeactivateLicense()}
              disabled={!canDeactivate || isRefreshing || isClearing}
            >
              {isClearing
                ? "Désactivation..."
                : "Désactiver la licence sur cet appareil"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
