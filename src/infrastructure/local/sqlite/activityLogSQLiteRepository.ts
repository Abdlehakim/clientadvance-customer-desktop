import type { ActivityLogRepository } from "@/domain/repositories";
import type { ActivityLog, ActivityLogCreateInput } from "@/domain/types";
import { uid } from "@/infrastructure/local/localStorageDatabase";
import { requireCurrentCompanyScope } from "@/infrastructure/auth/currentCompanyScope";
import {
  ACTIVITY_LOG_RETENTION_DAYS,
  getActivityLogRetentionCutoffIso,
} from "@/services/activityLogRetention";
import { getDb, type SqliteRow } from "./sqliteClient";

interface ActivityLogSqliteRow extends SqliteRow {
  id: unknown;
  user_id: unknown;
  user_name: unknown;
  action_type: unknown;
  description: unknown;
  entity_type: unknown;
  entity_id: unknown;
  created_at: unknown;
  pending_sync: unknown;
  sync_status: unknown;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
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

function readSyncStatus(value: unknown): ActivityLog["sync_status"] {
  return value === "failed" || value === "synced" || value === "local" || value === "pending"
    ? value
    : "pending";
}

function toActivityLog(row: ActivityLogSqliteRow): ActivityLog {
  return {
    id: readString(row.id),
    user_id: readString(row.user_id),
    user_name: readString(row.user_name),
    action_type: readString(row.action_type),
    description: readString(row.description),
    entity_type: readString(row.entity_type),
    entity_id: readString(row.entity_id),
    created_at: readString(row.created_at),
    pending_sync: readBoolean(row.pending_sync),
    sync_status: readSyncStatus(row.sync_status),
  };
}

export async function cleanupOldActivityLogs(
  retentionDays = ACTIVITY_LOG_RETENTION_DAYS,
  companyScope = requireCurrentCompanyScope(),
) {
  const db = await getDb();
  const result = await db.execute(
    `
      DELETE FROM activity_logs
      WHERE company_id = ?
        AND created_at < ?
    `,
    [companyScope, getActivityLogRetentionCutoffIso(retentionDays)],
  );

  return result.rowsAffected;
}

export const activityLogSQLiteRepository: ActivityLogRepository = {
  async getAll() {
    const companyScope = requireCurrentCompanyScope();
    await cleanupOldActivityLogs(ACTIVITY_LOG_RETENTION_DAYS, companyScope);

    const db = await getDb();
    const rows = await db.query<ActivityLogSqliteRow>(
      `
        SELECT
          id,
          user_id,
          user_name,
          action_type,
          description,
          entity_type,
          entity_id,
          created_at,
          pending_sync,
          sync_status
        FROM activity_logs
        WHERE company_id = ?
        ORDER BY created_at DESC
      `,
      [companyScope],
    );

    return rows.map(toActivityLog);
  },
  async create(input: ActivityLogCreateInput) {
    const companyScope = requireCurrentCompanyScope();
    await cleanupOldActivityLogs(ACTIVITY_LOG_RETENTION_DAYS, companyScope);

    const log: ActivityLog = {
      ...input,
      id: uid(),
      created_at: new Date().toISOString(),
      pending_sync: true,
      sync_status: "pending",
    };
    const db = await getDb();

    await db.execute(
      `
        INSERT INTO activity_logs (
          id,
          company_id,
          user_id,
          user_name,
          action_type,
          description,
          entity_type,
          entity_id,
          created_at,
          pending_sync,
          sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        log.id,
        companyScope,
        log.user_id,
        log.user_name,
        log.action_type,
        log.description,
        log.entity_type,
        log.entity_id,
        log.created_at,
        1,
        log.sync_status ?? "pending",
      ],
    );

    return log;
  },
};
