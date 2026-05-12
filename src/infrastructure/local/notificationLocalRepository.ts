import type {
  ClearSentNotificationsOptions,
  NotificationRepository,
} from "@/domain/repositories";
import type { NotificationItem } from "@/domain/types";
import { KEYS, read, uid, write } from "./localStorageDatabase";

const list = () => read<NotificationItem[]>(KEYS.notifications, []);

function isSyncedNotification(notification: NotificationItem) {
  return (
    notification.pending_sync !== true &&
    notification.sync_status !== "pending" &&
    notification.sync_status !== "failed"
  );
}

function shouldClearSentNotification(
  notification: NotificationItem,
  options: ClearSentNotificationsOptions = {},
) {
  if (notification.status !== "sent") {
    return false;
  }

  if (options.syncedOnly && !isSyncedNotification(notification)) {
    return false;
  }

  if (!options.sentBefore) {
    return true;
  }

  return typeof notification.sent_at === "string" && notification.sent_at < options.sentBefore;
}

export const notificationLocalRepository: NotificationRepository = {
  getAll() {
    return list();
  },
  create(input) {
    const notification: NotificationItem = {
      ...input,
      id: uid(),
      created_at: new Date().toISOString(),
      status: "queued",
      error_message: null,
      sent_at: null,
      pending_sync: true,
      sync_status: "pending",
    };

    write(KEYS.notifications, [notification, ...list()]);
    return notification;
  },
  markAsSending(id) {
    write(
      KEYS.notifications,
      list().map((notification) =>
        notification.id === id
          ? {
              ...notification,
              status: "sending",
              error_message: null,
              sent_at: null,
              pending_sync: true,
              sync_status: "pending" as const,
            }
          : notification,
      ),
    );
  },
  markAsSent(id) {
    write(
      KEYS.notifications,
      list().map((notification) =>
        notification.id === id
          ? {
              ...notification,
              status: "sent",
              error_message: null,
              sent_at: new Date().toISOString(),
              pending_sync: true,
              sync_status: "pending" as const,
            }
          : notification,
      ),
    );
  },
  markAsFailed(id, errorMessage) {
    write(
      KEYS.notifications,
      list().map((notification) =>
        notification.id === id
          ? {
              ...notification,
              status: "failed",
              error_message: errorMessage ?? notification.error_message ?? "Notification en échec.",
              sent_at: new Date().toISOString(),
              pending_sync: true,
              sync_status: "pending" as const,
            }
          : notification,
      ),
    );
  },
  clearSent(options) {
    const notifications = list();
    const nextNotifications = notifications.filter(
      (notification) => !shouldClearSentNotification(notification, options),
    );
    const deletedCount = notifications.length - nextNotifications.length;

    if (deletedCount > 0) {
      write(KEYS.notifications, nextNotifications);
    }

    return deletedCount;
  },
};
