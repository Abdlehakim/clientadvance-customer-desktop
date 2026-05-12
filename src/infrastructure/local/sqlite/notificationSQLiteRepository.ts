import type {
  ClearSentNotificationsOptions,
  NotificationRepository,
} from "@/domain/repositories";
import type { NotificationCreateInput, NotificationItem, NotificationStatus } from "@/domain/types";
import { uid } from "@/infrastructure/local/localStorageDatabase";
import { getDb, type SqliteRow } from "./sqliteClient";

interface NotificationSqliteRow extends SqliteRow {
  id: unknown;
  type: unknown;
  recipient: unknown;
  subject: unknown;
  body: unknown;
  payment_id: unknown;
  status: unknown;
  error_message: unknown;
  created_at: unknown;
  sent_at: unknown;
  pending_sync: unknown;
  sync_status: unknown;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    return value === "1" || value.toLowerCase() === "true";
  }

  return false;
}

function readNotificationStatus(value: unknown): NotificationStatus {
  return value === "sent" ||
    value === "failed" ||
    value === "queued" ||
    value === "sending"
    ? value
    : "queued";
}

function readSyncStatus(value: unknown): NotificationItem["sync_status"] {
  return value === "failed" || value === "synced" || value === "local" || value === "pending"
    ? value
    : "pending";
}

function toNotification(row: NotificationSqliteRow): NotificationItem {
  return {
    id: readString(row.id),
    type: readString(row.type) === "whatsapp" ? "whatsapp" : "email",
    recipient: readString(row.recipient),
    subject: readString(row.subject),
    body: readString(row.body),
    payment_id: readString(row.payment_id),
    status: readNotificationStatus(row.status),
    error_message: readNullableString(row.error_message),
    created_at: readString(row.created_at),
    sent_at: readNullableString(row.sent_at),
    pending_sync: readBoolean(row.pending_sync),
    sync_status: readSyncStatus(row.sync_status),
  };
}

export const notificationSQLiteRepository: NotificationRepository = {
  async getAll() {
    const db = await getDb();
    const rows = await db.query<NotificationSqliteRow>(
      `
        SELECT
          id,
          type,
          recipient,
          subject,
          body,
          payment_id,
          status,
          error_message,
          created_at,
          sent_at,
          pending_sync,
          sync_status
        FROM notification_queue
        ORDER BY created_at DESC
      `,
    );

    return rows.map(toNotification);
  },
  async create(input: NotificationCreateInput) {
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
    const db = await getDb();

    await db.execute(
      `
        INSERT INTO notification_queue (
          id,
          type,
          recipient,
          subject,
          body,
          payment_id,
          status,
          error_message,
          created_at,
          sent_at,
          pending_sync,
          sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        notification.id,
        notification.type,
        notification.recipient,
        notification.subject,
        notification.body,
        notification.payment_id,
        notification.status,
        notification.error_message,
        notification.created_at,
        notification.sent_at,
        1,
        notification.sync_status ?? "pending",
      ],
    );

    return notification;
  },
  async markAsSending(id: string) {
    const db = await getDb();

    await db.execute(
      `
        UPDATE notification_queue
        SET
          status = ?,
          error_message = ?,
          sent_at = ?,
          pending_sync = ?,
          sync_status = ?
        WHERE id = ?
      `,
      ["sending", null, null, 1, "pending", id],
    );
  },
  async markAsSent(id: string) {
    const db = await getDb();

    await db.execute(
      `
        UPDATE notification_queue
        SET
          status = ?,
          error_message = ?,
          sent_at = ?,
          pending_sync = ?,
          sync_status = ?
        WHERE id = ?
      `,
      ["sent", null, new Date().toISOString(), 1, "pending", id],
    );
  },
  async markAsFailed(id: string, errorMessage?: string) {
    const db = await getDb();

    await db.execute(
      `
        UPDATE notification_queue
        SET
          status = ?,
          error_message = ?,
          sent_at = ?,
          pending_sync = ?,
          sync_status = ?
        WHERE id = ?
      `,
      [
        "failed",
        errorMessage ?? "Notification en échec.",
        new Date().toISOString(),
        1,
        "pending",
        id,
      ],
    );
  },
  async clearSent(options: ClearSentNotificationsOptions = {}) {
    const db = await getDb();
    const conditions = ["status = ?"];
    const params: Array<string | number | boolean | null> = ["sent"];

    if (options.syncedOnly) {
      conditions.push("pending_sync = 0");
      conditions.push("sync_status NOT IN (?, ?)");
      params.push("pending", "failed");
    }

    if (options.sentBefore) {
      conditions.push("sent_at IS NOT NULL");
      conditions.push("sent_at < ?");
      params.push(options.sentBefore);
    }

    const result = await db.execute(
      `
        DELETE FROM notification_queue
        WHERE ${conditions.join(" AND ")}
      `,
      params,
    );

    return result.rowsAffected;
  },
};
