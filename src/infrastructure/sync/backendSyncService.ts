import type { SyncRepository, SyncResult } from "@/domain/repositories";
import type {
  ActivityLog,
  AdminSettings,
  Client,
  NotificationItem,
  Payment,
} from "@/domain/types";
import { apiFetch, ApiError } from "@/infrastructure/remote/apiClient";
import { normalizeAdminSettings } from "@/infrastructure/local/adminSettingsState";
import {
  KEYS,
  emitChange,
  isBrowser,
  read,
} from "@/infrastructure/local/localStorageDatabase";
import { authLocalRepository } from "@/infrastructure/local/authLocalRepository";
import {
  isConnectionOnline,
  setConnectionTestOverride,
} from "@/services/connectionService";

interface SyncPushPayload {
  clients: Array<{
    id: string;
    nom_complet: string;
    telephone: string;
    adresse: string;
    email: string;
    cin: string;
    created_at: string;
    updated_at: string;
    created_by: string;
    updated_by: string;
    deleted_at?: string | null;
    remote_updated_at?: string;
    pending_sync?: boolean;
    sync_status?: string;
  }>;
  payments: Array<{
    id: string;
    client_id: string;
    montant: number;
    date_paiement: string;
    heure_paiement: string;
    created_by: string;
    created_at: string;
    remote_updated_at?: string;
    pending_sync?: boolean;
    sync_status?: string;
  }>;
  adminSettings: {
    id: string;
    admin_email: string;
    admin_whatsapp: string;
    server_mode?: AdminSettings["server_mode"];
    notification_delivery_mode?: AdminSettings["notification_delivery_mode"];
    updated_at: string;
    updated_by?: string;
    remote_updated_at?: string;
    pending_sync?: boolean;
    sync_status?: string;
  } | null;
  activityLogs: Array<{
    id: string;
    user_id: string;
    user_name: string;
    action_type: string;
    description: string;
    entity_type: string;
    entity_id: string;
    created_at: string;
  }>;
  notifications: Array<{
    id: string;
    type: "email" | "whatsapp";
    recipient: string;
    subject: string;
    body: string;
    payment_id: string;
    status: "pending" | "sent" | "failed";
    error_message?: string | null;
    created_at: string;
    sent_at?: string | null;
  }>;
}

interface SyncPushResponse {
  success: boolean;
  synced: {
    clients: number;
    payments: number;
    adminSettings: number;
    activityLogs: number;
    notifications: number;
  };
  failedItems: Array<{
    entity: "client" | "payment" | "adminSettings" | "activityLog" | "notification";
    id?: string;
    reason: string;
  }>;
  serverTimestamp: string;
}

interface SyncPullResponse {
  clients: Array<{
    id: string;
    nom_complet: string;
    telephone: string;
    adresse: string;
    email: string;
    cin: string;
    created_at: string;
    updated_at: string;
    created_by: string;
    updated_by: string;
    deleted_at?: string | null;
    remote_updated_at?: string;
  }>;
  payments: Array<{
    id: string;
    client_id: string;
    montant: number;
    date_paiement: string;
    heure_paiement: string;
    created_by: string;
    created_at: string;
    remote_updated_at?: string;
  }>;
  adminSettings: {
    id: string;
    admin_email: string;
    admin_whatsapp: string;
    updated_at: string;
    updated_by?: string;
    remote_updated_at?: string;
  } | null;
  activityLogs: Array<{
    id: string;
    user_id: string;
    user_name: string;
    action_type: string;
    description: string;
    entity_type: string;
    entity_id: string;
    created_at: string;
  }>;
  notifications: Array<{
    id: string;
    type: "email" | "whatsapp";
    recipient: string;
    subject: string;
    body: string;
    payment_id: string;
    status: "pending" | "sent" | "failed";
    error_message?: string | null;
    created_at: string;
    sent_at?: string | null;
  }>;
  serverTimestamp: string;
}

const EMPTY_SETTINGS: AdminSettings = {
  id: "settings_default",
  admin_email: "",
  admin_whatsapp: "",
  notification_retention_days: 30,
  setup_completed: false,
  server_mode: "with-server",
  notification_delivery_mode: "backend",
  smtp_provider_type: "custom",
  smtp_host: "",
  smtp_port: 587,
  smtp_username: "",
  smtp_password: "",
  smtp_password_configured: false,
  smtp_secure: true,
  smtp_from_email: "",
  smtp_from_name: "",
  updated_at: new Date(0).toISOString(),
  updated_by: "",
  remote_updated_at: undefined,
  pending_sync: false,
  sync_status: "synced",
};

function readClients() {
  return read<Client[]>(KEYS.clients, []);
}

function readPayments() {
  return read<Payment[]>(KEYS.payments, []);
}

function readSettings() {
  return normalizeAdminSettings(read<AdminSettings>(KEYS.settings, EMPTY_SETTINGS));
}

function readLogs() {
  return read<ActivityLog[]>(KEYS.logs, []);
}

function readNotifications() {
  return read<NotificationItem[]>(KEYS.notifications, []);
}

function writeSnapshot(snapshot: {
  clients: Client[];
  payments: Payment[];
  settings: AdminSettings;
  logs: ActivityLog[];
  notifications: NotificationItem[];
  lastSync?: string;
}) {
  if (!isBrowser()) return;

  localStorage.setItem(KEYS.clients, JSON.stringify(snapshot.clients));
  localStorage.setItem(KEYS.payments, JSON.stringify(snapshot.payments));
  localStorage.setItem(KEYS.settings, JSON.stringify(snapshot.settings));
  localStorage.setItem(KEYS.logs, JSON.stringify(snapshot.logs));
  localStorage.setItem(KEYS.notifications, JSON.stringify(snapshot.notifications));

  if (snapshot.lastSync) {
    localStorage.setItem(KEYS.lastSync, snapshot.lastSync);
  }

  emitChange();
}

function isPendingSync(item: { pending_sync?: boolean; sync_status?: string }) {
  return item.pending_sync === true || item.sync_status === "pending" || item.sync_status === "failed";
}

function isPendingNotification(item: NotificationItem) {
  return isPendingSync(item);
}

function shouldPushNotification(
  notification: NotificationItem,
  notificationDeliveryMode: AdminSettings["notification_delivery_mode"],
) {
  if (!isPendingNotification(notification)) {
    return false;
  }

  // Desktop-email mode delivers email locally after sync, so queued email items
  // must not be pushed as backend-pending work.
  if (
    notificationDeliveryMode === "desktop-email" &&
    notification.type === "email" &&
    notification.status !== "sent" &&
    notification.status !== "failed"
  ) {
    return false;
  }

  return true;
}

function isPendingLog(item: ActivityLog) {
  return item.pending_sync !== false;
}

function getPendingBreakdown() {
  const clients = readClients().filter(isPendingSync).length;
  const payments = readPayments().filter(isPendingSync).length;
  const adminSettings = isPendingSync(readSettings()) ? 1 : 0;
  const activityLogs = readLogs().filter(isPendingLog).length;
  const notifications = readNotifications().filter(isPendingNotification).length;

  return {
    clients,
    payments,
    adminSettings,
    activityLogs,
    notifications,
    total: clients + payments + adminSettings + activityLogs + notifications,
  };
}

function toQueuedStatus(status?: string) {
  if (status === "pending") return "queued" as const;
  if (status === "sent") return "sent" as const;
  if (status === "failed") return "failed" as const;
  return "queued" as const;
}

function getActor() {
  const user = authLocalRepository.getCurrentUser();
  return {
    id: user?.id ?? "",
    name: user?.name ?? "—",
  };
}

function preparePushPayload(actorId: string): SyncPushPayload {
  const clients = readClients().filter(isPendingSync).map((client) => ({
    ...client,
    created_by: actorId,
    updated_by: actorId,
    remote_updated_at: client.remote_updated_at ?? client.updated_at,
  }));

  const payments = readPayments().filter(isPendingSync).map((payment) => ({
    ...payment,
    created_by: actorId,
    remote_updated_at: payment.remote_updated_at ?? payment.created_at,
  }));

  const settings = readSettings();
  const notificationDeliveryMode = settings.notification_delivery_mode;
  const adminSettings = isPendingSync(settings)
    ? {
        id: "settings_default",
        admin_email: settings.admin_email,
        admin_whatsapp: settings.admin_whatsapp,
        updated_at: settings.updated_at,
        updated_by: actorId,
        remote_updated_at: settings.remote_updated_at ?? settings.updated_at,
        pending_sync: settings.pending_sync,
        sync_status: settings.sync_status,
      }
    : null;

  const activityLogs = readLogs().filter(isPendingLog).map((log) => ({
    id: log.id,
    user_id: log.user_id,
    user_name: log.user_name,
    action_type: log.action_type,
    description: log.description,
    entity_type: log.entity_type,
    entity_id: log.entity_id,
    created_at: log.created_at,
  }));

  const notificationSyncTimestamp = new Date().toISOString();
  const notifications = readNotifications().filter((notification) =>
    shouldPushNotification(notification, notificationDeliveryMode),
  ).map((notification) => {
    const status =
      notification.status === "sent"
        ? ("sent" as const)
        : notification.status === "failed"
          ? ("failed" as const)
          : ("pending" as const);
    const sentAt =
      notification.sent_at ??
      (status === "pending" ? null : notificationSyncTimestamp);

    return {
      id: notification.id,
      type: notification.type,
      recipient: notification.recipient,
      subject: notification.subject,
      body: notification.body,
      payment_id: notification.payment_id,
      status,
      error_message: notification.error_message ?? null,
      created_at: notification.created_at,
      sent_at: sentAt,
    };
  });

  return {
    clients,
    payments,
    adminSettings,
    activityLogs,
    notifications,
  };
}

function markPushResult(pushResponse: SyncPushResponse, payload: SyncPushPayload) {
  const failedClients = new Set(pushResponse.failedItems.filter((item) => item.entity === "client" && item.id).map((item) => item.id!));
  const failedPayments = new Set(pushResponse.failedItems.filter((item) => item.entity === "payment" && item.id).map((item) => item.id!));
  const failedLogs = new Set(pushResponse.failedItems.filter((item) => item.entity === "activityLog" && item.id).map((item) => item.id!));
  const failedNotifications = new Set(pushResponse.failedItems.filter((item) => item.entity === "notification" && item.id).map((item) => item.id!));
  const settingsFailed = pushResponse.failedItems.some((item) => item.entity === "adminSettings");

  const pushedClientIds = new Set(payload.clients.map((item) => item.id));
  const pushedPaymentIds = new Set(payload.payments.map((item) => item.id));
  const pushedLogIds = new Set(payload.activityLogs.map((item) => item.id));
  const pushedNotificationIds = new Set(payload.notifications.map((item) => item.id));

  const clients = readClients().map((client) => {
    if (!pushedClientIds.has(client.id)) return client;
    if (failedClients.has(client.id)) {
      return { ...client, pending_sync: true, sync_status: "failed" as const };
    }
    return { ...client, pending_sync: false, sync_status: "synced" as const };
  });

  const payments = readPayments().map((payment) => {
    if (!pushedPaymentIds.has(payment.id)) return payment;
    if (failedPayments.has(payment.id)) {
      return { ...payment, pending_sync: true, sync_status: "failed" as const };
    }
    return { ...payment, pending_sync: false, sync_status: "synced" as const };
  });

  const currentSettings = readSettings();
  const settings = payload.adminSettings
    ? settingsFailed
      ? { ...currentSettings, pending_sync: true, sync_status: "failed" as const }
      : { ...currentSettings, id: "settings_default", pending_sync: false, sync_status: "synced" as const }
    : currentSettings;

  const logs = readLogs().map((log) => {
    if (!pushedLogIds.has(log.id)) return log;
    if (failedLogs.has(log.id)) {
      return { ...log, pending_sync: true, sync_status: "failed" as const };
    }
    return { ...log, pending_sync: false, sync_status: "synced" as const };
  });

  const notifications = readNotifications().map((notification) => {
    if (!pushedNotificationIds.has(notification.id)) return notification;
    if (failedNotifications.has(notification.id)) {
      return { ...notification, pending_sync: true, sync_status: "failed" as const };
    }
    return { ...notification, pending_sync: false, sync_status: "synced" as const };
  });

  writeSnapshot({ clients, payments, settings, logs, notifications });
}

function upsertClients(pulledClients: SyncPullResponse["clients"]) {
  const localById = new Map(readClients().map((client) => [client.id, client]));

  for (const serverClient of pulledClients) {
    const local = localById.get(serverClient.id);

    if (local?.pending_sync) {
      continue;
    }

    const nextClient: Client = {
      id: serverClient.id,
      nom_complet: serverClient.nom_complet,
      telephone: serverClient.telephone,
      adresse: serverClient.adresse,
      email: serverClient.email,
      cin: serverClient.cin,
      created_at: serverClient.created_at,
      updated_at: serverClient.updated_at,
      created_by: local?.created_by || serverClient.created_by,
      updated_by: local?.updated_by || serverClient.updated_by,
      deleted_at: serverClient.deleted_at ?? null,
      remote_updated_at: serverClient.remote_updated_at,
      pending_sync: false,
      sync_status: "synced",
    };

    localById.set(serverClient.id, nextClient);
  }

  return Array.from(localById.values());
}

function upsertPayments(pulledPayments: SyncPullResponse["payments"]) {
  const localById = new Map(readPayments().map((payment) => [payment.id, payment]));

  for (const serverPayment of pulledPayments) {
    const local = localById.get(serverPayment.id);

    if (local?.pending_sync) {
      continue;
    }

    const nextPayment: Payment = {
      id: serverPayment.id,
      client_id: serverPayment.client_id,
      montant: serverPayment.montant,
      date_paiement: serverPayment.date_paiement,
      heure_paiement: serverPayment.heure_paiement,
      created_by: local?.created_by || serverPayment.created_by,
      created_at: serverPayment.created_at,
      remote_updated_at: serverPayment.remote_updated_at,
      pending_sync: false,
      sync_status: "synced",
    };

    localById.set(serverPayment.id, nextPayment);
  }

  return Array.from(localById.values());
}

function upsertSettings(pulledSettings: SyncPullResponse["adminSettings"]) {
  const localSettings = readSettings();

  if (!pulledSettings || localSettings.pending_sync) {
    return localSettings;
  }

  return {
    ...localSettings,
    id: pulledSettings.id,
    admin_email: pulledSettings.admin_email,
    admin_whatsapp: pulledSettings.admin_whatsapp,
    server_mode: pulledSettings.server_mode ?? localSettings.server_mode,
    notification_delivery_mode:
      pulledSettings.notification_delivery_mode ??
      localSettings.notification_delivery_mode,
    updated_at: pulledSettings.updated_at,
    updated_by: localSettings.updated_by || pulledSettings.updated_by || "",
    remote_updated_at: pulledSettings.remote_updated_at,
    pending_sync: false,
    sync_status: "synced" as const,
  } satisfies AdminSettings;
}

function upsertLogs(pulledLogs: SyncPullResponse["activityLogs"]) {
  const localById = new Map(readLogs().map((log) => [log.id, log]));

  for (const serverLog of pulledLogs) {
    const local = localById.get(serverLog.id);

    if (local?.pending_sync) {
      localById.set(serverLog.id, {
        ...local,
        pending_sync: false,
        sync_status: "synced",
      });
      continue;
    }

    localById.set(serverLog.id, {
      id: serverLog.id,
      user_id: serverLog.user_id,
      user_name: serverLog.user_name,
      action_type: serverLog.action_type,
      description: serverLog.description,
      entity_type: serverLog.entity_type,
      entity_id: serverLog.entity_id,
      created_at: serverLog.created_at,
      pending_sync: false,
      sync_status: "synced",
    });
  }

  return Array.from(localById.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function upsertNotifications(pulledNotifications: SyncPullResponse["notifications"]) {
  const localById = new Map(readNotifications().map((notification) => [notification.id, notification]));

  for (const serverNotification of pulledNotifications) {
    const local = localById.get(serverNotification.id);

    if (local?.pending_sync) {
      localById.set(serverNotification.id, {
        ...local,
        status: toQueuedStatus(serverNotification.status),
        error_message: serverNotification.error_message ?? null,
        sent_at: serverNotification.sent_at ?? null,
        pending_sync: false,
        sync_status: "synced",
      });
      continue;
    }

    localById.set(serverNotification.id, {
      id: serverNotification.id,
      type: serverNotification.type,
      recipient: serverNotification.recipient,
      subject: serverNotification.subject,
      body: serverNotification.body,
      payment_id: serverNotification.payment_id,
      status: toQueuedStatus(serverNotification.status),
      error_message: serverNotification.error_message ?? null,
      created_at: serverNotification.created_at,
      sent_at: serverNotification.sent_at ?? null,
      pending_sync: false,
      sync_status: "synced",
    });
  }

  return Array.from(localById.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function totalSynced(result: SyncPushResponse["synced"]) {
  return result.clients + result.payments + result.adminSettings + result.activityLogs + result.notifications;
}

export const backendSyncService: SyncRepository = {
  isOnlineMode() {
    return isConnectionOnline();
  },
  setOnlineMode(value) {
    setConnectionTestOverride(value);
  },
  getLastSync() {
    return read<string | null>(KEYS.lastSync, null);
  },
  getPendingCount() {
    return getPendingBreakdown().total;
  },
  async syncPendingData(): Promise<SyncResult> {
    if (!this.isOnlineMode()) {
      return { ok: false, synced: 0 };
    }

    const actor = getActor();
    const payload = preparePushPayload(actor.id);
    const since = this.getLastSync();

    try {
      const pushResponse = await apiFetch<SyncPushResponse>("/sync/push", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      markPushResult(pushResponse, payload);

      const pullQuery = since ? `?since=${encodeURIComponent(since)}` : "";
      const pullResponse = await apiFetch<SyncPullResponse>(`/sync/pull${pullQuery}`);

      const clients = upsertClients(pullResponse.clients);
      const payments = upsertPayments(pullResponse.payments);
      const settings = upsertSettings(pullResponse.adminSettings);
      const logs = upsertLogs(pullResponse.activityLogs);
      const notifications = upsertNotifications(pullResponse.notifications);

      writeSnapshot({
        clients,
        payments,
        settings,
        logs,
        notifications,
        lastSync: pullResponse.serverTimestamp,
      });

      return {
        ok: true,
        synced: totalSynced(pushResponse.synced),
      };
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        throw new Error("Synchronisation impossible. Serveur indisponible.");
      }

      throw error instanceof Error ? error : new Error("Synchronisation impossible.");
    }
  },
};
