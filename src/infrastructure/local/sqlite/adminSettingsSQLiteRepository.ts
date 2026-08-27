import type { AdminSettingsRepository } from "@/domain/repositories";
import type { AdminSettings } from "@/domain/types";
import { getCurrentUserSession } from "@/infrastructure/auth/currentUserSession";
import {
  getCompanySettingsId,
  requireCurrentCompanyScope,
} from "@/infrastructure/auth/currentCompanyScope";
import {
  applyAdminSettingsUpdate,
  createAdminSettingsFallback,
  didSyncableAdminSettingsChange,
  normalizeSmtpPasswordValue,
  normalizeAdminSettings,
} from "@/infrastructure/local/adminSettingsState";
import { getStoredSmtpPassword, persistStoredSmtpPassword } from "@/infrastructure/local/smtpPasswordStorage";
import { activityLogSQLiteRepository } from "./activityLogSQLiteRepository";
import { getDb, type SqliteRow } from "./sqliteClient";
import { buildOutboxUpsertStatement } from "./syncOutboxSQLiteRepository";

interface AdminSettingsSqliteRow extends SqliteRow {
  id: unknown;
  admin_email: unknown;
  admin_whatsapp: unknown;
  notification_retention_days: unknown;
  setup_completed: unknown;
  server_mode: unknown;
  notification_delivery_mode: unknown;
  smtp_provider_type: unknown;
  smtp_host: unknown;
  smtp_port: unknown;
  smtp_username: unknown;
  smtp_password_configured: unknown;
  smtp_secure: unknown;
  smtp_from_email: unknown;
  smtp_from_name: unknown;
  updated_at: unknown;
  updated_by: unknown;
  remote_updated_at: unknown;
  server_version: unknown;
  pending_sync: unknown;
  sync_status: unknown;
}

function fallback(settingsId: string): AdminSettings {
  return { ...createAdminSettingsFallback(), id: settingsId };
}

function readString(value: unknown, defaultValue = "") {
  return typeof value === "string" ? value : defaultValue;
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

function readNumber(value: unknown, fallbackValue = 587) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallbackValue;
}

function readSyncStatus(value: unknown): AdminSettings["sync_status"] {
  return value === "failed" || value === "synced" || value === "local" || value === "pending"
    ? value
    : "synced";
}

function toAdminSettings(row: AdminSettingsSqliteRow, settingsId: string): AdminSettings {
  return normalizeAdminSettings({
    id: readString(row.id, settingsId),
    server_version: Math.max(0, Math.trunc(readNumber(row.server_version, 0))),
    admin_email: readString(row.admin_email),
    admin_whatsapp: readString(row.admin_whatsapp),
    notification_retention_days: readNumber(row.notification_retention_days, 30),
    setup_completed: readBoolean(row.setup_completed),
    server_mode: readString(row.server_mode),
    notification_delivery_mode: readString(row.notification_delivery_mode),
    smtp_provider_type: readString(row.smtp_provider_type),
    smtp_host: readString(row.smtp_host),
    smtp_port: readNumber(row.smtp_port),
    smtp_username: readString(row.smtp_username),
    smtp_password_configured: readBoolean(row.smtp_password_configured),
    smtp_secure: readBoolean(row.smtp_secure),
    smtp_from_email: readString(row.smtp_from_email),
    smtp_from_name: readString(row.smtp_from_name),
    updated_at: readString(row.updated_at),
    updated_by: readString(row.updated_by),
    remote_updated_at: readNullableString(row.remote_updated_at) ?? undefined,
    pending_sync: readBoolean(row.pending_sync),
    sync_status: readSyncStatus(row.sync_status),
  });
}

export const adminSettingsSQLiteRepository: AdminSettingsRepository = {
  async get() {
    const companyScope = requireCurrentCompanyScope();
    const settingsId = getCompanySettingsId(companyScope);
    const db = await getDb();
    const rows = await db.query<AdminSettingsSqliteRow>(
      `
        SELECT
          id,
          admin_email,
          admin_whatsapp,
          notification_retention_days,
          setup_completed,
          server_mode,
          notification_delivery_mode,
          smtp_provider_type,
          smtp_host,
          smtp_port,
          smtp_username,
          smtp_password_configured,
          smtp_secure,
          smtp_from_email,
          smtp_from_name,
          updated_at,
          updated_by,
          remote_updated_at,
          server_version,
          pending_sync,
          sync_status
        FROM admin_settings
        WHERE company_id = ?
        LIMIT 1
      `,
      [companyScope],
    );

    return rows[0] ? toAdminSettings(rows[0], settingsId) : fallback(settingsId);
  },
  async update(patch) {
    const companyScope = requireCurrentCompanyScope();
    const settingsId = getCompanySettingsId(companyScope);
    const user = getCurrentUserSession();

    if (user?.role !== "admin") {
      throw new Error("Accès refusé. Cette section est réservée à l’administrateur.");
    }

    const current = await this.get();
    const updatedAt = new Date().toISOString();
    const syncableChanged = didSyncableAdminSettingsChange(current, patch);
    const nextPassword = normalizeSmtpPasswordValue(patch.smtp_password);
    const hasStoredPassword = (await getStoredSmtpPassword()).length > 0;
    const next = { ...applyAdminSettingsUpdate(current, patch, {
      updatedAt,
      updatedBy: user?.name ?? current.updated_by ?? "",
      smtpPasswordConfigured: nextPassword
        ? true
        : current.smtp_password_configured || hasStoredPassword,
    }), id: settingsId };
    const db = await getDb();

    if (nextPassword) {
      await persistStoredSmtpPassword(nextPassword);
    }

    const settingsStatement = {
      sql: `
        INSERT INTO admin_settings (
          id,
          company_id,
          admin_email,
          admin_whatsapp,
          notification_retention_days,
          setup_completed,
          server_mode,
          notification_delivery_mode,
          smtp_provider_type,
          smtp_host,
          smtp_port,
          smtp_username,
          smtp_password_configured,
          smtp_secure,
          smtp_from_email,
          smtp_from_name,
          updated_at,
          updated_by,
          remote_updated_at,
          server_version,
          pending_sync,
          sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(company_id) DO UPDATE SET
          admin_email = excluded.admin_email,
          admin_whatsapp = excluded.admin_whatsapp,
          notification_retention_days = excluded.notification_retention_days,
          setup_completed = excluded.setup_completed,
          server_mode = excluded.server_mode,
          notification_delivery_mode = excluded.notification_delivery_mode,
          smtp_provider_type = excluded.smtp_provider_type,
          smtp_host = excluded.smtp_host,
          smtp_port = excluded.smtp_port,
          smtp_username = excluded.smtp_username,
          smtp_password_configured = excluded.smtp_password_configured,
          smtp_secure = excluded.smtp_secure,
          smtp_from_email = excluded.smtp_from_email,
          smtp_from_name = excluded.smtp_from_name,
          updated_at = excluded.updated_at,
          updated_by = excluded.updated_by,
          remote_updated_at = excluded.remote_updated_at,
          server_version = admin_settings.server_version,
          pending_sync = excluded.pending_sync,
          sync_status = excluded.sync_status
        WHERE admin_settings.company_id = excluded.company_id
      `,
      params: [
        next.id,
        companyScope,
        next.admin_email,
        next.admin_whatsapp,
        next.notification_retention_days,
        next.setup_completed ? 1 : 0,
        next.server_mode,
        next.notification_delivery_mode,
        next.smtp_provider_type,
        next.smtp_host,
        next.smtp_port,
        next.smtp_username,
        next.smtp_password_configured ? 1 : 0,
        next.smtp_secure ? 1 : 0,
        next.smtp_from_email,
        next.smtp_from_name,
        next.updated_at,
        next.updated_by ?? "",
        next.remote_updated_at ?? null,
        next.server_version,
        next.pending_sync ? 1 : 0,
        next.sync_status,
      ],
    };

    await db.transaction([
      settingsStatement,
      ...(syncableChanged
        ? [buildOutboxUpsertStatement({
            companyId: companyScope,
            entityType: "adminSettings" as const,
            entityId: settingsId,
            action: "update" as const,
            baseVersion: current.server_version,
            payload: {
              admin_email: next.admin_email,
              admin_whatsapp: next.admin_whatsapp,
            },
            now: updatedAt,
          })]
        : []),
    ]);

    await activityLogSQLiteRepository.create({
      user_id: user?.id ?? "",
      user_name: user?.name ?? "-",
      action_type: "settings_update",
      description: "Mise à jour des paramètres administrateur",
      entity_type: "settings",
      entity_id: settingsId,
    });
  },
};
