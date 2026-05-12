import type { SyncStatus } from "./sync";

export type NotificationChannel = "email" | "whatsapp";
export type NotificationStatus = "queued" | "sending" | "sent" | "failed";

export interface NotificationItem {
  id: string;
  type: NotificationChannel;
  recipient: string;
  subject: string;
  body: string;
  created_at: string;
  payment_id: string;
  status?: NotificationStatus;
  error_message?: string | null;
  sent_at?: string | null;
  pending_sync?: boolean;
  sync_status?: SyncStatus;
}

export type NotificationCreateInput = Omit<
  NotificationItem,
  "id" | "created_at" | "status" | "error_message" | "sent_at" | "pending_sync" | "sync_status"
>;
