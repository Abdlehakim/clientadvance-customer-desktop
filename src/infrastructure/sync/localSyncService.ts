import type { SyncRepository } from "@/domain/repositories";
import type { ActivityLog, AdminSettings, Client, NotificationItem, Payment } from "@/domain/types";
import { KEYS, emitChange, isBrowser, read } from "../local/localStorageDatabase";
import { normalizeAdminSettings } from "../local/adminSettingsState";
import {
  isConnectionOnline,
  setConnectionTestOverride,
} from "@/services/connectionService";

const isPendingSync = (item: { pending_sync?: boolean; sync_status?: string }) =>
  item.pending_sync === true || item.sync_status === "pending" || item.sync_status === "failed";

const isPendingNotification = (notification: NotificationItem) => isPendingSync(notification);

function getPendingBreakdown() {
  const clients = read<Client[]>(KEYS.clients, []).filter(isPendingSync).length;
  const payments = read<Payment[]>(KEYS.payments, []).filter(isPendingSync).length;
  const adminSettings = isPendingSync(
    normalizeAdminSettings(
      read<AdminSettings>(KEYS.settings, { pending_sync: false } as AdminSettings),
    ),
  )
    ? 1
    : 0;
  const activityLogs = read<ActivityLog[]>(KEYS.logs, []).filter(
    (log) => log.pending_sync !== false,
  ).length;
  const notifications = read<NotificationItem[]>(KEYS.notifications, []).filter(
    isPendingNotification,
  ).length;

  return {
    clients,
    payments,
    adminSettings,
    activityLogs,
    notifications,
    total: clients + payments + adminSettings + activityLogs + notifications,
  };
}

export const localSyncService: SyncRepository = {
  isOnlineMode() {
    return isConnectionOnline();
  },
  setOnlineMode(v) {
    setConnectionTestOverride(v);
  },
  getLastSync() {
    return read<string | null>(KEYS.lastSync, null);
  },
  getPendingCount() {
    return getPendingBreakdown().total;
  },
  syncPendingData() {
    if (!this.isOnlineMode()) return { ok: false, synced: 0 };
    let count = 0;

    const clients = read<Client[]>(KEYS.clients, []).map((client) =>
      isPendingSync(client) ? (count++, { ...client, pending_sync: false, sync_status: "synced" as const }) : client,
    );
    const payments = read<Payment[]>(KEYS.payments, []).map((payment) =>
      isPendingSync(payment)
        ? (count++, { ...payment, pending_sync: false, sync_status: "synced" as const })
        : payment,
    );
    const settings = normalizeAdminSettings(
      read<AdminSettings>(KEYS.settings, { pending_sync: false } as AdminSettings),
    );
    const nextSettings = isPendingSync(settings)
      ? { ...settings, pending_sync: false, sync_status: "synced" as const }
      : settings;
    if (isPendingSync(settings)) count++;

    const logs = read<ActivityLog[]>(KEYS.logs, []).map((log) =>
      log.pending_sync !== false ? (count++, { ...log, pending_sync: false, sync_status: "synced" as const }) : log,
    );
    const notifications = read<NotificationItem[]>(KEYS.notifications, []).map((notification) =>
      isPendingNotification(notification)
        ? (count++, { ...notification, pending_sync: false, sync_status: "synced" as const })
        : notification,
    );

    if (isBrowser()) {
      localStorage.setItem(KEYS.clients, JSON.stringify(clients));
      localStorage.setItem(KEYS.payments, JSON.stringify(payments));
      localStorage.setItem(KEYS.settings, JSON.stringify(nextSettings));
      localStorage.setItem(KEYS.logs, JSON.stringify(logs));
      localStorage.setItem(KEYS.notifications, JSON.stringify(notifications));
      localStorage.setItem(KEYS.lastSync, new Date().toISOString());
    }

    emitChange();
    return { ok: true, synced: count };
  },
};
