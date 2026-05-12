import type { NotificationItem } from "@/domain/types";
import { readNotificationDeliveryMode } from "@/infrastructure/local/adminSettingsState";
import { toast } from "sonner";
import { getAdminSettings, getNotifications, isOnline } from "./appServices";
import {
  deliverNotificationById,
  isNotificationPendingDelivery,
  type NotificationDeliveryResult,
} from "./notificationDeliveryService";

const INITIAL_PAYMENT_NOTIFICATION_DELAY_MS = 2000;
const BETWEEN_PAYMENT_NOTIFICATION_DELAY_MS = 2000;
const PAYMENT_DELIVERY_FAILED_TOAST =
  "Paiement enregistré, mais l'envoi email a échoué.";

const scheduledPaymentTimers = new Map<string, ReturnType<typeof setTimeout>>();
const deferredNotificationIds = new Set<string>();
const inFlightNotificationIds = new Set<string>();
const inFlightPaymentDeliveries = new Map<string, Promise<PaymentDeliverySummary>>();

let activeQueuedDeliveryPromise: Promise<NotificationDeliveryResult> | null = null;

interface PaymentDeliverySummary {
  attempted: boolean;
  sentCount: number;
  failedCount: number;
  errorMessages: string[];
}

function emptyPaymentSummary(): PaymentDeliverySummary {
  return {
    attempted: false,
    sentCount: 0,
    failedCount: 0,
    errorMessages: [],
  };
}

function emptyQueuedResult(mode: NotificationDeliveryResult["mode"]): NotificationDeliveryResult {
  return {
    mode,
    attempted: false,
    usedDesktopEmail: mode === "desktop-email",
    offline: false,
    backendRequired: false,
    sentCount: 0,
    failedCount: 0,
    whatsappDeferredCount: 0,
    remainingCount: 0,
    errorMessages: [],
  };
}

function getDesktopEmailMode() {
  const settings = getAdminSettings();
  const mode = readNotificationDeliveryMode(
    settings.notification_delivery_mode,
    settings.server_mode,
  );

  return {
    settings,
    mode,
    shouldUseDesktopEmail: mode === "desktop-email",
  };
}

function isNotificationDeferred(notificationId: string) {
  return deferredNotificationIds.has(notificationId);
}

function getRetryableEmailNotifications() {
  return getNotifications().filter(
    (notification) =>
      notification.type === "email" &&
      isNotificationPendingDelivery(notification) &&
      !isNotificationDeferred(notification.id),
  );
}

function orderPaymentNotifications(
  notifications: NotificationItem[],
  adminEmail: string,
) {
  const normalizedAdminEmail = adminEmail.trim().toLowerCase();

  return [...notifications].sort((left, right) => {
    const leftIsAdmin = left.recipient.trim().toLowerCase() === normalizedAdminEmail;
    const rightIsAdmin = right.recipient.trim().toLowerCase() === normalizedAdminEmail;

    if (leftIsAdmin !== rightIsAdmin) {
      return leftIsAdmin ? 1 : -1;
    }

    return left.created_at.localeCompare(right.created_at);
  });
}

function groupNotificationsByPayment(
  notifications: NotificationItem[],
  adminEmail: string,
) {
  const payments = new Map<string, NotificationItem[]>();
  const standalone: NotificationItem[] = [];

  for (const notification of notifications) {
    if (!notification.payment_id) {
      standalone.push(notification);
      continue;
    }

    const group = payments.get(notification.payment_id) ?? [];
    group.push(notification);
    payments.set(notification.payment_id, group);
  }

  const paymentGroups = Array.from(payments.entries())
    .sort((left, right) => {
      const leftCreatedAt = left[1][0]?.created_at ?? "";
      const rightCreatedAt = right[1][0]?.created_at ?? "";
      return leftCreatedAt.localeCompare(rightCreatedAt);
    })
    .map(([, groupedNotifications]) =>
      orderPaymentNotifications(groupedNotifications, adminEmail),
    );

  const orderedStandalone = [...standalone].sort((left, right) =>
    left.created_at.localeCompare(right.created_at),
  );

  return { paymentGroups, standalone: orderedStandalone };
}

function clearScheduledPaymentTimer(paymentId: string) {
  const timer = scheduledPaymentTimers.get(paymentId);

  if (!timer) {
    return;
  }

  clearTimeout(timer);
  scheduledPaymentTimers.delete(paymentId);
}

function setDeferredNotificationsForPayment(paymentId: string) {
  const { shouldUseDesktopEmail } = getDesktopEmailMode();

  if (!shouldUseDesktopEmail) {
    return;
  }

  for (const notification of getNotifications()) {
    if (
      notification.payment_id === paymentId &&
      notification.type === "email" &&
      isNotificationPendingDelivery(notification)
    ) {
      deferredNotificationIds.add(notification.id);
    }
  }
}

function releaseDeferredNotificationsForPayment(paymentId: string) {
  for (const notification of getNotifications()) {
    if (notification.payment_id === paymentId) {
      deferredNotificationIds.delete(notification.id);
    }
  }
}

async function deliverOrderedNotifications(
  notifications: NotificationItem[],
  delayBetweenNotificationsMs: number,
) {
  const summary = emptyPaymentSummary();

  for (let index = 0; index < notifications.length; index += 1) {
    const notification = notifications[index];

    if (inFlightNotificationIds.has(notification.id)) {
      continue;
    }

    if (index > 0 && delayBetweenNotificationsMs > 0) {
      await delay(delayBetweenNotificationsMs);
    }

    inFlightNotificationIds.add(notification.id);

    try {
      const result = await deliverNotificationById(notification.id, {
        backendAvailable: false,
      });

      if (result.status === "sent") {
        summary.attempted = true;
        summary.sentCount += 1;
        continue;
      }

      if (result.status === "failed") {
        summary.attempted = true;
        summary.failedCount += 1;

        if (result.errorMessage) {
          summary.errorMessages.push(result.errorMessage);
        }
      }
    } finally {
      inFlightNotificationIds.delete(notification.id);
    }
  }

  return summary;
}

export function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isNotificationDeliveryDeferred(notificationId: string) {
  return isNotificationDeferred(notificationId);
}

export function schedulePaymentNotifications(paymentId: string) {
  const { shouldUseDesktopEmail } = getDesktopEmailMode();

  if (!shouldUseDesktopEmail) {
    return;
  }

  clearScheduledPaymentTimer(paymentId);
  setDeferredNotificationsForPayment(paymentId);

  const timer = setTimeout(() => {
    scheduledPaymentTimers.delete(paymentId);
    void deliverPaymentNotificationsSequentially(paymentId, {
      showFailureToast: true,
    });
  }, INITIAL_PAYMENT_NOTIFICATION_DELAY_MS);

  scheduledPaymentTimers.set(paymentId, timer);
}

export async function deliverPaymentNotificationsSequentially(
  paymentId: string,
  options: { showFailureToast?: boolean } = {},
) {
  const existingPromise = inFlightPaymentDeliveries.get(paymentId);

  if (existingPromise) {
    return existingPromise;
  }

  const deliveryPromise = (async () => {
    clearScheduledPaymentTimer(paymentId);

    const { settings, shouldUseDesktopEmail } = getDesktopEmailMode();
    const summary = emptyPaymentSummary();

    if (!shouldUseDesktopEmail) {
      releaseDeferredNotificationsForPayment(paymentId);
      return summary;
    }

    if (!isOnline()) {
      releaseDeferredNotificationsForPayment(paymentId);
      return summary;
    }

    const notifications = orderPaymentNotifications(
      getNotifications().filter(
        (notification) =>
          notification.payment_id === paymentId &&
          notification.type === "email" &&
          isNotificationPendingDelivery(notification),
      ),
      settings.admin_email,
    );

    releaseDeferredNotificationsForPayment(paymentId);

    if (notifications.length === 0) {
      return summary;
    }

    const deliverySummary = await deliverOrderedNotifications(
      notifications,
      BETWEEN_PAYMENT_NOTIFICATION_DELAY_MS,
    );

    if (options.showFailureToast && deliverySummary.failedCount > 0) {
      toast.error(PAYMENT_DELIVERY_FAILED_TOAST);
    }

    return deliverySummary;
  })().finally(() => {
    inFlightPaymentDeliveries.delete(paymentId);
  });

  inFlightPaymentDeliveries.set(paymentId, deliveryPromise);
  return deliveryPromise;
}

export async function deliverQueuedNotifications(): Promise<NotificationDeliveryResult> {
  if (activeQueuedDeliveryPromise) {
    return activeQueuedDeliveryPromise;
  }

  activeQueuedDeliveryPromise = (async () => {
    const { settings, mode, shouldUseDesktopEmail } = getDesktopEmailMode();
    const result = emptyQueuedResult(mode);
    const notifications = getRetryableEmailNotifications();

    result.remainingCount = notifications.length;

    if (notifications.length === 0) {
      return result;
    }

    if (!isOnline()) {
      result.offline = true;
      return result;
    }

    if (!shouldUseDesktopEmail) {
      result.backendRequired = true;
      return result;
    }

    result.attempted = true;

    const { paymentGroups, standalone } = groupNotificationsByPayment(
      notifications,
      settings.admin_email,
    );

    for (const paymentNotifications of paymentGroups) {
      const summary = await deliverOrderedNotifications(paymentNotifications, 0);
      result.sentCount += summary.sentCount;
      result.failedCount += summary.failedCount;
      result.errorMessages.push(...summary.errorMessages);
    }

    if (standalone.length > 0) {
      const summary = await deliverOrderedNotifications(standalone, 0);
      result.sentCount += summary.sentCount;
      result.failedCount += summary.failedCount;
      result.errorMessages.push(...summary.errorMessages);
    }

    result.remainingCount = getRetryableEmailNotifications().length;
    return result;
  })().finally(() => {
    activeQueuedDeliveryPromise = null;
  });

  return activeQueuedDeliveryPromise;
}
