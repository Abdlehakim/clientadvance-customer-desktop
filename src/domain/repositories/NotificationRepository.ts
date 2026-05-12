import type { NotificationCreateInput, NotificationItem } from "@/domain/types";

export interface ClearSentNotificationsOptions {
  sentBefore?: string;
  syncedOnly?: boolean;
}

export interface NotificationRepository {
  getAll(): NotificationItem[] | Promise<NotificationItem[]>;
  create(input: NotificationCreateInput): NotificationItem | Promise<NotificationItem>;
  markAsSending(id: string): void | Promise<void>;
  markAsSent(id: string): void | Promise<void>;
  markAsFailed(id: string, errorMessage?: string): void | Promise<void>;
  clearSent(options?: ClearSentNotificationsOptions): number | Promise<number>;
}
