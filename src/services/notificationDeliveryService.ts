import type { NotificationDeliveryMode, NotificationItem } from "@/domain/types";
import {
  hasSmtpConfiguration,
  normalizeSmtpPasswordForProvider,
  readNotificationDeliveryMode,
} from "@/infrastructure/local/adminSettingsState";
import { getStoredSmtpPassword } from "@/infrastructure/local/smtpPasswordStorage";
import { sendDesktopEmail } from "@/infrastructure/local/sqlite/desktopEmailClient";
import { isTauriRuntime } from "@/infrastructure/local/sqlite/sqliteClient";
import { getFriendlySmtpErrorMessage } from "@/lib/smtpErrorMessage";
import {
  cleanupOldSentNotifications,
  getAdminSettings,
  getNotifications,
  initializeStorageDriver,
  isOnline,
  notificationService,
} from "./appServices";

const MISSING_SMTP_MESSAGE =
  "Paramètres SMTP manquants. Veuillez les configurer dans l'espace administrateur.";
const DESKTOP_EMAIL_UNAVAILABLE_MESSAGE =
  "Email direct depuis l'application indisponible hors application desktop.";
const GMAIL_SMTP_HOST = "smtp.gmail.com";
const GMAIL_SMTP_PORT = 587;

export interface NotificationDeliveryResult {
  mode: NotificationDeliveryMode;
  attempted: boolean;
  usedDesktopEmail: boolean;
  offline: boolean;
  backendRequired: boolean;
  sentCount: number;
  failedCount: number;
  whatsappDeferredCount: number;
  remainingCount: number;
  errorMessages: string[];
}

interface NotificationDeliveryOptions {
  backendAvailable: boolean;
  retryFailed?: boolean;
}

export interface SingleNotificationDeliveryResult {
  mode: NotificationDeliveryMode;
  attempted: boolean;
  usedDesktopEmail: boolean;
  offline: boolean;
  backendRequired: boolean;
  status: "sent" | "failed" | "skipped";
  errorMessage: string | null;
}

function emptyResult(mode: NotificationDeliveryMode): NotificationDeliveryResult {
  return {
    mode,
    attempted: false,
    usedDesktopEmail: false,
    offline: false,
    backendRequired: false,
    sentCount: 0,
    failedCount: 0,
    whatsappDeferredCount: 0,
    remainingCount: 0,
    errorMessages: [],
  };
}

export function isNotificationPendingDelivery(notification: NotificationItem) {
  return (
    notification.status === undefined ||
    notification.status === "queued" ||
    notification.status === "sending"
  );
}

function readCurrentNotifications() {
  return Promise.resolve(getNotifications());
}

async function markNotificationAsSent(id: string) {
  await Promise.resolve(notificationService.markAsSent(id));
}

async function markNotificationAsSending(id: string) {
  await Promise.resolve(notificationService.markAsSending(id));
}

async function markNotificationAsFailed(id: string, errorMessage: string) {
  await Promise.resolve(notificationService.markAsFailed(id, errorMessage));
}

async function readRemainingEmailNotificationCount() {
  const notifications = await readCurrentNotifications();
  return notifications.filter(
    (notification) =>
      notification.type === "email" && isNotificationPendingDelivery(notification),
  ).length;
}

async function runNotificationRetentionCleanup() {
  try {
    await cleanupOldSentNotifications();
  } catch (error) {
    console.error("Notification cleanup failed after delivery.", error);
  }
}

function resolveDesktopEmailConfig(
  settings: ReturnType<typeof getAdminSettings>,
  smtpPassword: string,
) {
  const isGmail = settings.smtp_provider_type === "gmail";
  const host = isGmail ? GMAIL_SMTP_HOST : settings.smtp_host.trim();
  const port = isGmail ? GMAIL_SMTP_PORT : settings.smtp_port;
  const username = settings.smtp_username.trim();
  const fromEmail = isGmail
    ? settings.smtp_from_email.trim() || username
    : settings.smtp_from_email.trim();
  const secure = isGmail ? false : settings.smtp_secure;
  const normalizedPassword = normalizeSmtpPasswordForProvider(
    settings.smtp_provider_type,
    smtpPassword,
  );
  const smtpPasswordConfigured =
    settings.smtp_password_configured || normalizedPassword.length > 0;

  if (
    !hasSmtpConfiguration({
      ...settings,
      smtp_host: host,
      smtp_port: port,
      smtp_username: username,
      smtp_from_email: fromEmail,
      smtp_secure: secure,
      smtp_password_configured: smtpPasswordConfigured,
    }) ||
    normalizedPassword.length === 0
  ) {
    return null;
  }

  return {
    host,
    port,
    username,
    password: normalizedPassword,
    secure,
    fromEmail,
    fromName: settings.smtp_from_name,
  };
}

function emptySingleResult(mode: NotificationDeliveryMode): SingleNotificationDeliveryResult {
  return {
    mode,
    attempted: false,
    usedDesktopEmail: false,
    offline: false,
    backendRequired: false,
    status: "skipped",
    errorMessage: null,
  };
}

async function deliverDesktopEmailNotification(
  notification: NotificationItem,
  settings: ReturnType<typeof getAdminSettings>,
): Promise<SingleNotificationDeliveryResult> {
  const result = emptySingleResult("desktop-email");

  result.attempted = true;
  result.usedDesktopEmail = true;

  if (!isTauriRuntime()) {
    await markNotificationAsFailed(notification.id, DESKTOP_EMAIL_UNAVAILABLE_MESSAGE);
    result.status = "failed";
    result.errorMessage = DESKTOP_EMAIL_UNAVAILABLE_MESSAGE;
    return result;
  }

  const smtpPassword = await getStoredSmtpPassword();
  const smtpConfig = resolveDesktopEmailConfig(settings, smtpPassword);

  if (!smtpConfig) {
    await markNotificationAsFailed(notification.id, MISSING_SMTP_MESSAGE);
    result.status = "failed";
    result.errorMessage = MISSING_SMTP_MESSAGE;
    return result;
  }

  await markNotificationAsSending(notification.id);

  try {
    await sendDesktopEmail({
      host: smtpConfig.host,
      port: smtpConfig.port,
      username: smtpConfig.username,
      password: smtpConfig.password,
      secure: smtpConfig.secure,
      fromEmail: smtpConfig.fromEmail,
      fromName: smtpConfig.fromName,
      to: notification.recipient,
      subject: notification.subject,
      body: notification.body,
    });
    await markNotificationAsSent(notification.id);
    await runNotificationRetentionCleanup();
    result.status = "sent";
    return result;
  } catch (error) {
    console.error("SMTP notification delivery failed.", error);

    const message = getFriendlySmtpErrorMessage(
      error,
      settings.smtp_provider_type,
    );
    await markNotificationAsFailed(notification.id, message);
    result.status = "failed";
    result.errorMessage = message;
    return result;
  }
}

export async function deliverNotificationById(
  notificationId: string,
  options: NotificationDeliveryOptions = { backendAvailable: false },
): Promise<SingleNotificationDeliveryResult> {
  await initializeStorageDriver().catch(() => null);

  const settings = getAdminSettings();
  const mode = readNotificationDeliveryMode(
    settings.notification_delivery_mode,
    settings.server_mode,
  );
  const result = emptySingleResult(mode);
  const notification = (await readCurrentNotifications()).find(
    (candidate) => candidate.id === notificationId,
  );

  if (
    !notification ||
    (!isNotificationPendingDelivery(notification) &&
      !(options.retryFailed === true && notification.status === "failed"))
  ) {
    return result;
  }

  if (!isOnline()) {
    result.offline = true;
    result.backendRequired =
      mode !== "desktop-email" && notification.type === "whatsapp";
    return result;
  }

  if (mode !== "desktop-email") {
    result.backendRequired = notification.type === "whatsapp" || options.backendAvailable;
    return result;
  }

  if (notification.type !== "email") {
    return result;
  }

  return deliverDesktopEmailNotification(notification, settings);
}

export async function deliverQueuedNotifications(
  options: NotificationDeliveryOptions,
): Promise<NotificationDeliveryResult> {
  await initializeStorageDriver().catch(() => null);

  const settings = getAdminSettings();
  const mode = readNotificationDeliveryMode(
    settings.notification_delivery_mode,
    settings.server_mode,
  );
  const result = emptyResult(mode);
  const shouldUseDesktopEmail = mode === "desktop-email";
  const allRetryableNotifications = (await readCurrentNotifications()).filter(
    isNotificationPendingDelivery,
  );
  const notifications = shouldUseDesktopEmail
    ? allRetryableNotifications.filter((notification) => notification.type === "email")
    : allRetryableNotifications;

  result.remainingCount = notifications.length;

  if (notifications.length === 0) {
    return result;
  }

  if (!isOnline()) {
    result.offline = true;
    result.backendRequired =
      !shouldUseDesktopEmail &&
      notifications.some((notification) => notification.type === "whatsapp");
    return result;
  }

  if (!shouldUseDesktopEmail) {
    result.backendRequired = notifications.length > 0;
    result.whatsappDeferredCount = notifications.filter(
      (notification) => notification.type === "whatsapp",
    ).length;
    return result;
  }

  result.attempted = true;
  result.usedDesktopEmail = true;
  result.whatsappDeferredCount = 0;
  result.backendRequired = false;

  for (const notification of notifications) {
    const delivery = await deliverNotificationById(notification.id, options);

    if (delivery.status === "sent") {
      result.sentCount += 1;
      continue;
    }

    if (delivery.status === "failed") {
      result.failedCount += 1;

      if (delivery.errorMessage) {
        result.errorMessages.push(delivery.errorMessage);
      }
    }
  }

  result.remainingCount = await readRemainingEmailNotificationCount();
  return result;
}
