import { useEffect, useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { TunisianPhoneInput } from "@/components/TunisianPhoneInput";
import { APP_INPUT_WITH_RIGHT_ICON_CLASS_NAME } from "@/components/inputStyles";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Switch } from "@/components/ui/switch";
import type { AdminSettings, SmtpProviderType, User } from "@/domain/types";
import {
  WHATSAPP_BACKEND_REQUIRED_MESSAGE,
  getNotificationDeliveryModeForServerMode,
  normalizeSmtpPasswordValue,
} from "@/infrastructure/local/adminSettingsState";
import { getStoredSmtpPassword } from "@/infrastructure/local/smtpPasswordStorage";
import type { SqliteDatabaseInfo } from "@/infrastructure/local/sqlite/sqliteClient";
import { getCurrentUser, updateAdminSettings } from "@/lib/data";
import {
  TUNISIAN_PHONE_VALIDATION_MESSAGE,
  formatTunisianLocalPhone,
  isValidTunisianPhone,
  normalizeTunisianPhone,
} from "@/lib/tunisianPhone";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DatabaseLocationCard } from "@/components/DatabaseLocationCard";

const GMAIL_SMTP_HOST = "smtp.gmail.com";
const GMAIL_SMTP_PORT = "587";
const DEFAULT_ADMIN_EMAILS = new Set(["admin@example.com", "admin@demo.com"]);

type SetupStepId = "welcome" | "notifications" | "smtp" | "database" | "review";

interface SetupStep {
  id: SetupStepId;
  label: string;
}

const SETUP_STEPS: SetupStep[] = [
  { id: "welcome", label: "Accueil" },
  { id: "notifications", label: "Notifications" },
  { id: "smtp", label: "Email SMTP" },
  { id: "database", label: "Base locale" },
  { id: "review", label: "Terminer" },
];

interface InitialAdminSetupDialogProps {
  open: boolean;
  settings: AdminSettings;
  onCompleted: () => void;
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isDefaultAdminEmail(value: string) {
  return DEFAULT_ADMIN_EMAILS.has(value.trim().toLowerCase());
}

function resolveInitialNotificationEmail(settings: AdminSettings, user: User | null) {
  const savedEmail = normalizeOptionalString(settings.admin_email);

  if (savedEmail && !isDefaultAdminEmail(savedEmail)) {
    return savedEmail;
  }

  return (
    normalizeOptionalString(user?.admin_email) ??
    normalizeOptionalString(user?.company_admin_email) ??
    normalizeOptionalString(user?.email) ??
    normalizeOptionalString(user?.company_contact_email) ??
    savedEmail ??
    ""
  );
}

function getSmtpProviderLabel(value: SmtpProviderType) {
  if (value === "gmail") {
    return "Gmail";
  }

  if (value === "professional") {
    return "Email professionnel / domaine personnalisé";
  }

  return "Configuration personnalisée";
}

function SetupSummaryItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

export function InitialAdminSetupDialog({
  open,
  settings,
  onCompleted,
}: InitialAdminSetupDialogProps) {
  const currentUser = getCurrentUser();
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [email, setEmail] = useState("");
  const [whatsApp, setWhatsApp] = useState("");
  const [notificationRetentionDays, setNotificationRetentionDays] = useState("30");
  const [smtpProviderType, setSmtpProviderType] = useState<SmtpProviderType>("gmail");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(GMAIL_SMTP_PORT);
  const [smtpUsername, setSmtpUsername] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpFromEmail, setSmtpFromEmail] = useState("");
  const [smtpFromName, setSmtpFromName] = useState("");
  const [smtpPasswordConfigured, setSmtpPasswordConfigured] = useState(false);
  const [isSmtpPasswordVisible, setIsSmtpPasswordVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [databaseLocation, setDatabaseLocation] = useState<SqliteDatabaseInfo | null>(null);

  const initialNotificationEmail = resolveInitialNotificationEmail(settings, currentUser);

  const currentStep = SETUP_STEPS[currentStepIndex] ?? SETUP_STEPS[0];
  const deliveryMode = getNotificationDeliveryModeForServerMode(settings.server_mode);
  const isWithoutServerMode = settings.server_mode === "without-server";
  const isGmailProvider = smtpProviderType === "gmail";
  const isProfessionalProvider = smtpProviderType === "professional";
  const serverModeLabel = settings.server_mode === "with-server" ? "Avec serveur" : "Sans serveur";
  const deliveryModeLabel =
    deliveryMode === "backend" ? "Serveur backend" : "Email direct depuis l'application";
  const modeDescription = isWithoutServerMode
    ? "Fonctionnement local sans serveur, avec envoi email direct depuis l'application."
    : "Utiliser le serveur backend pour la synchronisation et les notifications.";

  useEffect(() => {
    if (open) {
      setCurrentStepIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    const hydrateStoredSmtpPassword = async () => {
      try {
        const storedSmtpPassword = normalizeSmtpPasswordValue(await getStoredSmtpPassword());

        if (cancelled) {
          return;
        }

        setSmtpPassword(storedSmtpPassword);
        setSmtpPasswordConfigured(
          storedSmtpPassword.length > 0 || settings.smtp_password_configured,
        );
      } catch {
        if (!cancelled) {
          setSmtpPasswordConfigured(settings.smtp_password_configured);
        }
      }
    };

    setEmail(initialNotificationEmail);
    setWhatsApp(formatTunisianLocalPhone(settings.admin_whatsapp));
    setNotificationRetentionDays(String(settings.notification_retention_days));
    setSmtpProviderType(settings.smtp_provider_type);
    setSmtpHost(settings.smtp_provider_type === "gmail" ? GMAIL_SMTP_HOST : settings.smtp_host);
    setSmtpPort(
      settings.smtp_provider_type === "gmail" ? GMAIL_SMTP_PORT : String(settings.smtp_port),
    );
    setSmtpUsername(settings.smtp_username);
    setSmtpPassword("");
    setSmtpPasswordConfigured(settings.smtp_password_configured);
    setSmtpSecure(settings.smtp_provider_type === "gmail" ? false : settings.smtp_secure);
    setSmtpFromEmail(
      settings.smtp_provider_type === "gmail"
        ? settings.smtp_username.trim() || settings.smtp_from_email
        : settings.smtp_from_email,
    );
    setSmtpFromName(settings.smtp_from_name);
    setIsSmtpPasswordVisible(false);
    void hydrateStoredSmtpPassword();

    return () => {
      cancelled = true;
    };
  }, [
    initialNotificationEmail,
    open,
    settings.admin_whatsapp,
    settings.notification_retention_days,
    settings.smtp_from_email,
    settings.smtp_from_name,
    settings.smtp_host,
    settings.smtp_password_configured,
    settings.smtp_port,
    settings.smtp_provider_type,
    settings.smtp_secure,
    settings.smtp_username,
  ]);

  const applyGmailPreset = (username: string) => {
    setSmtpHost(GMAIL_SMTP_HOST);
    setSmtpPort(GMAIL_SMTP_PORT);
    setSmtpSecure(false);
    setSmtpFromEmail(username.trim());
  };

  const onSmtpProviderTypeChange = (value: SmtpProviderType) => {
    setSmtpProviderType(value);

    if (value === "gmail") {
      applyGmailPreset(smtpUsername);
    }
  };

  const onSmtpUsernameChange = (value: string) => {
    setSmtpUsername(value);

    if (isGmailProvider) {
      setSmtpFromEmail(value.trim());
    }
  };

  const getCurrentSmtpValues = () => {
    const nextEmail = email.trim();
    const nextSmtpHost = (isGmailProvider ? GMAIL_SMTP_HOST : smtpHost).trim();
    const nextSmtpPort = isGmailProvider ? 587 : Number(smtpPort);
    const nextSmtpUsername = smtpUsername.trim();
    const nextSmtpPassword = normalizeSmtpPasswordValue(smtpPassword);
    const nextSmtpFromEmail = isGmailProvider ? nextSmtpUsername : smtpFromEmail.trim();
    const smtpPasswordAvailable = nextSmtpPassword.length > 0 || smtpPasswordConfigured;

    return {
      nextEmail,
      nextSmtpHost,
      nextSmtpPort,
      nextSmtpUsername,
      nextSmtpPassword,
      nextSmtpFromEmail,
      smtpPasswordAvailable,
    };
  };

  const getNotificationRetentionDays = () => Math.trunc(Number(notificationRetentionDays));

  const isNotificationStepValid = (() => {
    const nextNotificationRetentionDays = getNotificationRetentionDays();

    return (
      email.trim().length > 0 &&
      Number.isFinite(nextNotificationRetentionDays) &&
      nextNotificationRetentionDays >= 1 &&
      (whatsApp.trim().length === 0 || isValidTunisianPhone(whatsApp))
    );
  })();

  const isSmtpStepValid = (() => {
    if (!isWithoutServerMode) {
      return true;
    }

    const {
      nextSmtpHost,
      nextSmtpPort,
      nextSmtpUsername,
      nextSmtpFromEmail,
      smtpPasswordAvailable,
    } = getCurrentSmtpValues();

    return (
      nextSmtpHost.length > 0 &&
      Number.isFinite(nextSmtpPort) &&
      nextSmtpPort > 0 &&
      nextSmtpUsername.length > 0 &&
      nextSmtpFromEmail.length > 0 &&
      smtpPasswordAvailable
    );
  })();

  const isCurrentStepValid =
    currentStep.id === "notifications"
      ? isNotificationStepValid
      : currentStep.id === "smtp"
        ? isSmtpStepValid
        : true;
  const isReadyToFinish = isNotificationStepValid && isSmtpStepValid;

  const validateAll = () => {
    const {
      nextEmail,
      nextSmtpHost,
      nextSmtpPort,
      nextSmtpUsername,
      nextSmtpPassword,
      nextSmtpFromEmail,
      smtpPasswordAvailable,
    } = getCurrentSmtpValues();
    const nextNotificationRetentionDays = getNotificationRetentionDays();
    const smtpIsValid =
      !isWithoutServerMode ||
      (nextSmtpHost.length > 0 &&
        Number.isFinite(nextSmtpPort) &&
        nextSmtpPort > 0 &&
        nextSmtpUsername.length > 0 &&
        nextSmtpFromEmail.length > 0 &&
        smtpPasswordAvailable);

    if (!nextEmail || !smtpIsValid) {
      toast.error("Veuillez compléter les champs obligatoires.");
      return null;
    }

    if (!Number.isFinite(nextNotificationRetentionDays) || nextNotificationRetentionDays < 1) {
      toast.error("Le nombre de jours de conservation doit être supérieur ou égal à 1.");
      return null;
    }

    if (whatsApp.trim().length > 0 && !isValidTunisianPhone(whatsApp)) {
      toast.error(TUNISIAN_PHONE_VALIDATION_MESSAGE);
      return null;
    }

    return {
      nextEmail,
      nextWhatsApp: whatsApp.trim().length > 0 ? normalizeTunisianPhone(whatsApp) : "",
      nextNotificationRetentionDays,
      nextSmtpHost,
      nextSmtpPort,
      nextSmtpUsername,
      nextSmtpPassword,
      nextSmtpFromEmail,
    };
  };

  const goToPreviousStep = () => {
    setCurrentStepIndex((previousStepIndex) => Math.max(previousStepIndex - 1, 0));
  };

  const goToNextStep = () => {
    if (!isCurrentStepValid) {
      toast.error("Veuillez compléter les champs obligatoires.");
      return;
    }

    setCurrentStepIndex((previousStepIndex) =>
      Math.min(previousStepIndex + 1, SETUP_STEPS.length - 1),
    );
  };

  const save = async () => {
    const validated = validateAll();

    if (!validated) {
      return;
    }

    setIsSaving(true);

    try {
      await Promise.resolve(
        updateAdminSettings({
          admin_email: validated.nextEmail,
          admin_whatsapp: validated.nextWhatsApp,
          notification_retention_days: validated.nextNotificationRetentionDays,
          smtp_provider_type: smtpProviderType,
          smtp_host: validated.nextSmtpHost,
          smtp_port: validated.nextSmtpPort,
          smtp_username: validated.nextSmtpUsername,
          smtp_password: validated.nextSmtpPassword || undefined,
          smtp_secure: isGmailProvider ? false : smtpSecure,
          smtp_from_email: validated.nextSmtpFromEmail,
          smtp_from_name: smtpFromName.trim(),
          setup_completed: true,
        }),
      );

      if (isGmailProvider) {
        applyGmailPreset(smtpUsername);
      }

      const persistedSmtpPassword =
        validated.nextSmtpPassword || normalizeSmtpPasswordValue(await getStoredSmtpPassword());
      setSmtpPassword(persistedSmtpPassword);
      setIsSmtpPasswordVisible(false);
      setSmtpPasswordConfigured(persistedSmtpPassword.length > 0);
      toast.success("Configuration enregistrée avec succès");
      onCompleted();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Échec d'enregistrement des paramètres.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const renderOwnerModes = () => (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-sm font-medium">Mode défini par le propriétaire</div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <div className="text-xs text-muted-foreground">Mode de fonctionnement</div>
          <div className="mt-1 text-sm font-medium">{serverModeLabel}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Mode d'envoi</div>
          <div className="mt-1 text-sm font-medium">{deliveryModeLabel}</div>
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{modeDescription}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Ces modes sont gérés par le propriétaire du logiciel.
      </p>
    </div>
  );

  const renderWelcomeStep = () => (
    <Card className="p-6 shadow-card">
      <div className="space-y-6">
        <div>
          <h3 className="font-semibold">Bienvenue</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Cette configuration prépare les paramètres locaux de ce poste avant l'utilisation de
            l'application.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <SetupSummaryItem
            label="Entreprise"
            value={currentUser?.company_name ?? "Non disponible"}
          />
          <SetupSummaryItem
            label="Administrateur"
            value={currentUser?.company_admin_name ?? currentUser?.name ?? "Non disponible"}
          />
          <SetupSummaryItem
            label="Email administrateur"
            value={
              currentUser?.company_admin_email ??
              currentUser?.admin_email ??
              currentUser?.email ??
              "Non disponible"
            }
          />
        </div>

        {renderOwnerModes()}
      </div>
    </Card>
  );

  const renderNotificationsStep = () => (
    <Card className="p-6 shadow-card">
      <div className="space-y-6">
        <div>
          <h3 className="font-semibold">Notifications</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Définissez les destinataires utilisés par ce poste pour les alertes.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Email de réception des notifications</Label>
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Numéro WhatsApp de réception</Label>
            <TunisianPhoneInput value={whatsApp} onChange={setWhatsApp} />
            <p className="text-xs text-muted-foreground">{WHATSAPP_BACKEND_REQUIRED_MESSAGE}</p>
          </div>

          <div className="space-y-1.5">
            <Label>Conservation des notifications envoyées (jours)</Label>
            <Input
              type="number"
              min={1}
              value={notificationRetentionDays}
              onChange={(event) => setNotificationRetentionDays(event.target.value)}
            />
          </div>
        </div>
      </div>
    </Card>
  );

  const renderSmtpStep = () => {
    if (!isWithoutServerMode) {
      return (
        <Card className="p-6 shadow-card">
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold">Paramètres email SMTP</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Le propriétaire a configuré l'envoi par serveur backend pour cette entreprise.
              </p>
            </div>
            <div className="rounded-md border bg-muted/30 p-4">
              <div className="text-sm font-medium">Configuration non requise</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Les paramètres SMTP locaux peuvent rester vides tant que le mode backend est actif.
              </p>
            </div>
          </div>
        </Card>
      );
    }

    return (
      <Card className="p-6 shadow-card">
        <div className="space-y-6">
          <div>
            <h3 className="font-semibold">Paramètres email SMTP</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Le mode sans serveur envoie les emails directement depuis l'application desktop. Ces
              paramètres sont requis pour l'envoi direct.
            </p>
          </div>

          <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
            <div className="space-y-1.5">
              <Label>Type de compte email</Label>
              <Select
                value={smtpProviderType}
                onValueChange={(value) => onSmtpProviderTypeChange(value as SmtpProviderType)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Type de compte email" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gmail">Gmail</SelectItem>
                  <SelectItem value="professional">
                    Email professionnel / domaine personnalisé
                  </SelectItem>
                  <SelectItem value="custom">Configuration personnalisée</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isGmailProvider ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
                Pour Gmail, utilisez un mot de passe d'application, pas le mot de passe normal du
                compte Gmail.
              </div>
            ) : null}

            {isProfessionalProvider ? (
              <div className="space-y-1 rounded-md border bg-background px-3 py-3 text-sm text-muted-foreground">
                <p>
                  Utilisez les paramètres SMTP fournis par votre hébergeur email, par exemple
                  Hostinger, OVH, cPanel, Zoho, Outlook professionnel, etc.
                </p>
                <p>
                  Exemples : <code>smtp.yourdomain.com</code>, <code>mail.yourdomain.com</code>,
                  Port 587 TLS, Port 465 SSL.
                </p>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Hôte SMTP</Label>
                <Input
                  value={smtpHost}
                  onChange={(event) => setSmtpHost(event.target.value)}
                  placeholder="smtp.exemple.com"
                  readOnly={isGmailProvider}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Port SMTP</Label>
                <Input
                  type="number"
                  value={smtpPort}
                  onChange={(event) => setSmtpPort(event.target.value)}
                  min={1}
                  readOnly={isGmailProvider}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Nom d'utilisateur SMTP</Label>
                <Input
                  value={smtpUsername}
                  onChange={(event) => onSmtpUsernameChange(event.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Mot de passe SMTP</Label>
                <div className="relative">
                  <Input
                    type={isSmtpPasswordVisible ? "text" : "password"}
                    value={smtpPassword}
                    onChange={(event) => setSmtpPassword(event.target.value)}
                    className={APP_INPUT_WITH_RIGHT_ICON_CLASS_NAME}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground"
                    aria-label={
                      isSmtpPasswordVisible
                        ? "Masquer le mot de passe SMTP"
                        : "Afficher le mot de passe SMTP"
                    }
                    onClick={() => setIsSmtpPasswordVisible((previousValue) => !previousValue)}
                  >
                    {isSmtpPasswordVisible ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Email expéditeur</Label>
                <Input
                  type="email"
                  value={smtpFromEmail}
                  onChange={(event) => setSmtpFromEmail(event.target.value)}
                  readOnly={isGmailProvider}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Nom expéditeur</Label>
                <Input
                  value={smtpFromName}
                  onChange={(event) => setSmtpFromName(event.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
              <div>
                <div className="text-sm font-medium">Connexion SMTP sécurisée</div>
                <div className="text-xs text-muted-foreground">
                  Active TLS / STARTTLS pour l'envoi direct.
                </div>
              </div>
              <Switch
                checked={smtpSecure}
                onCheckedChange={(checked) => {
                  if (!isGmailProvider) {
                    setSmtpSecure(checked);
                  }
                }}
                disabled={isGmailProvider}
              />
            </div>
          </div>
        </div>
      </Card>
    );
  };

  const renderDatabaseStep = () => (
    <DatabaseLocationCard
      description="Cet emplacement contrôle où la base locale hors ligne est stockée sur ce poste."
      onLocationChange={setDatabaseLocation}
    />
  );

  const renderReviewStep = () => (
    <Card className="p-6 shadow-card">
      <div className="space-y-6">
        <div>
          <h3 className="font-semibold">Résumé</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Vérifiez les paramètres avant de terminer la configuration initiale.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <SetupSummaryItem label="Mode de fonctionnement" value={serverModeLabel} />
          <SetupSummaryItem label="Mode d'envoi" value={deliveryModeLabel} />
          <SetupSummaryItem label="Email de réception" value={email.trim() || "-"} />
          <SetupSummaryItem
            label="WhatsApp de réception"
            value={whatsApp.trim().length > 0 ? `+216 ${whatsApp}` : "-"}
          />
          <SetupSummaryItem
            label="Conservation"
            value={`${notificationRetentionDays || "-"} jour(s)`}
          />
          <SetupSummaryItem
            label="Email SMTP"
            value={
              isWithoutServerMode
                ? `${getSmtpProviderLabel(smtpProviderType)} - ${
                    (isGmailProvider ? GMAIL_SMTP_HOST : smtpHost).trim() || "-"
                  }`
                : "Non requis en mode backend"
            }
          />
          <SetupSummaryItem
            label="Base locale"
            value={databaseLocation?.path ?? "Non disponible dans ce contexte"}
          />
        </div>
      </div>
    </Card>
  );

  const renderCurrentStep = () => {
    switch (currentStep.id) {
      case "welcome":
        return renderWelcomeStep();
      case "notifications":
        return renderNotificationsStep();
      case "smtp":
        return renderSmtpStep();
      case "database":
        return renderDatabaseStep();
      case "review":
        return renderReviewStep();
      default:
        return null;
    }
  };

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
            Suivez les étapes pour configurer ce poste avec les paramètres de l'entreprise.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 md:grid-cols-5">
          {SETUP_STEPS.map((step, index) => {
            const isActive = index === currentStepIndex;
            const isCompleted = index < currentStepIndex;

            return (
              <div
                key={step.id}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
                  isActive
                    ? "border-primary bg-primary/10 text-primary"
                    : isCompleted
                      ? "border-success/40 bg-success/10 text-[oklch(0.35_0.1_150)]"
                      : "bg-background text-muted-foreground",
                )}
                aria-current={isActive ? "step" : undefined}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : isCompleted
                        ? "border-success/40 bg-success/20"
                        : "border-muted-foreground/30",
                  )}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 truncate">{step.label}</span>
              </div>
            );
          })}
        </div>

        {renderCurrentStep()}

        <DialogFooter className="gap-2 sm:space-x-0">
          <Button
            type="button"
            variant="outline"
            onClick={goToPreviousStep}
            disabled={currentStepIndex === 0 || isSaving}
          >
            Précédent
          </Button>
          {currentStep.id === "review" ? (
            <Button
              type="button"
              onClick={() => void save()}
              disabled={!isReadyToFinish || isSaving}
            >
              {isSaving ? "Enregistrement..." : "Terminer la configuration"}
            </Button>
          ) : (
            <Button type="button" onClick={goToNextStep} disabled={!isCurrentStepValid || isSaving}>
              Suivant
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
