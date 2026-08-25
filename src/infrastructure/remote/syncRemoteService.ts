import type {
  ActivityLog,
  AdminSettings,
  Client,
  NotificationItem,
  NotificationStatus,
  Payment,
} from "@/domain/types";
import { apiFetch } from "@/infrastructure/remote/apiClient";

type BackendNotificationStatus = "pending" | "sent" | "failed";

export interface SyncRemoteRequest {
  clients: Client[];
  payments: Payment[];
  adminSettings: AdminSettings | null;
  activityLogs: ActivityLog[];
  notifications: NotificationItem[];
  since?: string;
}

export interface SyncRemoteClient {
  id: string;
  nom_complet: string;
  telephone: string;
  adresse: string;
  email: string;
  cin: string;
  cinIssuedAt?: string;
  birthDate?: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  deleted_at?: string | null;
  remote_updated_at?: string;
}

export interface SyncRemotePayment {
  id: string;
  client_id: string;
  montant: number;
  date_paiement: string;
  heure_paiement: string;
  created_by: string;
  created_at: string;
  remote_updated_at?: string;
}

export interface SyncRemoteAdminSettings {
  id?: string;
  admin_email?: string;
  admin_whatsapp?: string;
  updated_at?: string;
  updated_by?: string;
  remote_updated_at?: string;
}

export interface SyncRemoteActivityLog {
  id: string;
  user_id: string;
  user_name: string;
  action_type: string;
  description: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
}

interface BackendSyncNotification {
  id: string;
  type: "email" | "whatsapp";
  recipient: string;
  subject: string;
  body: string;
  payment_id: string;
  status: BackendNotificationStatus;
  error_message?: string | null;
  created_at: string;
  sent_at?: string | null;
}

export interface SyncRemoteNotification
  extends Omit<BackendSyncNotification, "status"> {
  status: NotificationStatus;
}

export interface SyncRemoteCounts {
  clients: number;
  payments: number;
  adminSettings: number;
  activityLogs: number;
  notifications: number;
}

export interface SyncRemoteFailedItem {
  entity: "client" | "payment" | "adminSettings" | "activityLog" | "notification";
  id?: string;
  reason: string;
}

interface BackendSyncFullResponse {
  clients: SyncRemoteClient[];
  payments: SyncRemotePayment[];
  adminSettings: SyncRemoteAdminSettings | null;
  activityLogs: SyncRemoteActivityLog[];
  notifications: BackendSyncNotification[];
  serverTimestamp: string;
  success: boolean;
  synced: SyncRemoteCounts;
  failedItems: SyncRemoteFailedItem[];
}

export interface SyncRemoteResult
  extends Omit<BackendSyncFullResponse, "notifications"> {
  notifications: SyncRemoteNotification[];
}

function toBackendNotificationStatus(
  status: NotificationItem["status"],
): BackendNotificationStatus {
  if (status === "sent" || status === "failed") {
    return status;
  }

  return "pending";
}

function toDesktopNotificationStatus(
  status: BackendNotificationStatus,
): NotificationStatus {
  if (status === "sent" || status === "failed") {
    return status;
  }

  return "queued";
}

function createRequestBody(payload: SyncRemoteRequest) {
  return {
    clients: payload.clients.map((client) => ({
      id: client.id,
      nom_complet: client.nom_complet,
      telephone: client.telephone,
      adresse: client.adresse,
      email: client.email,
      cin: client.cin,
      cinIssuedAt: client.cinIssuedAt ?? "",
      birthDate: client.birthDate ?? "",
      created_at: client.created_at,
      updated_at: client.updated_at,
      created_by: client.created_by,
      updated_by: client.updated_by,
      deleted_at: client.deleted_at ?? null,
      remote_updated_at: client.remote_updated_at,
    })),
    payments: payload.payments.map((payment) => ({
      id: payment.id,
      client_id: payment.client_id,
      montant: payment.montant,
      date_paiement: payment.date_paiement,
      heure_paiement: payment.heure_paiement,
      created_by: payment.created_by,
      created_at: payment.created_at,
      remote_updated_at: payment.remote_updated_at,
    })),
    adminSettings: payload.adminSettings
      ? {
          id: payload.adminSettings.id,
          admin_email: payload.adminSettings.admin_email,
          admin_whatsapp: payload.adminSettings.admin_whatsapp,
          updated_at: payload.adminSettings.updated_at,
          updated_by: payload.adminSettings.updated_by,
          remote_updated_at: payload.adminSettings.remote_updated_at,
        }
      : null,
    activityLogs: payload.activityLogs.map((log) => ({
      id: log.id,
      user_id: log.user_id,
      user_name: log.user_name,
      action_type: log.action_type,
      description: log.description,
      entity_type: log.entity_type,
      entity_id: log.entity_id,
      created_at: log.created_at,
    })),
    notifications: payload.notifications.map((notification) => ({
      id: notification.id,
      type: notification.type,
      recipient: notification.recipient,
      subject: notification.subject,
      body: notification.body,
      payment_id: notification.payment_id,
      status: toBackendNotificationStatus(notification.status),
      error_message: notification.error_message ?? null,
      created_at: notification.created_at,
      sent_at: notification.sent_at ?? null,
    })),
    ...(payload.since ? { since: payload.since } : {}),
  };
}

export const syncRemoteService = {
  async fullSync(payload: SyncRemoteRequest): Promise<SyncRemoteResult> {
    const result = await apiFetch<BackendSyncFullResponse>("/sync/full", {
      method: "POST",
      body: JSON.stringify(createRequestBody(payload)),
    });

    return {
      ...result,
      notifications: result.notifications.map((notification) => ({
        ...notification,
        status: toDesktopNotificationStatus(notification.status),
      })),
    };
  },
};
