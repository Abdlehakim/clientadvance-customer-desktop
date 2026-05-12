import type { AdminSettings, NotificationDeliveryMode, ServerMode } from "@/domain/types";
import {
  createAdminSettingsFallback,
  getNotificationDeliveryModeForServerMode,
  normalizeAdminSettings,
  readServerMode,
} from "@/infrastructure/local/adminSettingsState";
import {
  emitChange,
  isBrowser,
  KEYS,
  read,
  write,
} from "@/infrastructure/local/localStorageDatabase";
import {
  getDb,
  isTauriRuntime,
  type SqliteRow,
} from "@/infrastructure/local/sqlite/sqliteClient";
import { normalizeStoredTunisianPhone } from "@/lib/tunisianPhone";
import { reloadSqliteCache } from "@/services/sqliteCachedServices";

interface ServerAdminSettingsPayload {
  server_mode?: unknown;
  notification_delivery_mode?: unknown;
  admin_email?: unknown;
  admin_whatsapp?: unknown;
  company_admin_email?: unknown;
  company_contact_email?: unknown;
  company_contact_phone?: unknown;
  email?: unknown;
  role?: unknown;
}

interface NormalizedServerAdminSettings {
  server_mode: ServerMode | null;
  notification_delivery_mode: NotificationDeliveryMode | null;
  admin_email: string | null;
  admin_whatsapp: string | null;
}

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
  pending_sync: unknown;
  sync_status: unknown;
}

const SETTINGS_ID = "settings_default";
const PLACEHOLDER_ADMIN_EMAILS = new Set(["admin@example.com", "admin@demo.com"]);
const PLACEHOLDER_ADMIN_PHONE_DIGITS = new Set(["21622000000", "212600000000"]);

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function digitsOnly(value: string) {
  return value.replace(/\D+/g, "");
}

function isPlaceholderAdminEmail(value: string) {
  return PLACEHOLDER_ADMIN_EMAILS.has(value.trim().toLowerCase());
}

function isPlaceholderAdminPhone(value: string) {
  return PLACEHOLDER_ADMIN_PHONE_DIGITS.has(digitsOnly(value));
}

function hasHydrationPayload(value: ServerAdminSettingsPayload | null | undefined) {
  return (
    value?.server_mode === "with-server" ||
    value?.server_mode === "without-server" ||
    value?.notification_delivery_mode === "backend" ||
    value?.notification_delivery_mode === "desktop-email" ||
    normalizeOptionalString(value?.admin_email) !== null ||
    normalizeOptionalString(value?.admin_whatsapp) !== null ||
    normalizeOptionalString(value?.company_admin_email) !== null ||
    normalizeOptionalString(value?.company_contact_email) !== null ||
    normalizeOptionalString(value?.company_contact_phone) !== null ||
    (value?.role === "admin" && normalizeOptionalString(value?.email) !== null)
  );
}

function resolveAdminEmail(value: ServerAdminSettingsPayload) {
  return (
    normalizeOptionalString(value.admin_email) ??
    normalizeOptionalString(value.company_admin_email) ??
    (value.role === "admin" ? normalizeOptionalString(value.email) : null) ??
    normalizeOptionalString(value.company_contact_email)
  );
}

function resolveAdminWhatsapp(value: ServerAdminSettingsPayload) {
  const raw =
    normalizeOptionalString(value.admin_whatsapp) ??
    normalizeOptionalString(value.company_contact_phone);

  return raw ? normalizeStoredTunisianPhone(raw) : null;
}

function normalizeServerAdminSettings(
  value: ServerAdminSettingsPayload | null | undefined,
): NormalizedServerAdminSettings | null {
  if (!hasHydrationPayload(value)) {
    return null;
  }

  const hasModePayload =
    value?.server_mode === "with-server" ||
    value?.server_mode === "without-server" ||
    value?.notification_delivery_mode === "backend" ||
    value?.notification_delivery_mode === "desktop-email";
  const serverMode = hasModePayload
    ? readServerMode(value?.server_mode, value?.notification_delivery_mode)
    : null;

  return {
    server_mode: serverMode,
    notification_delivery_mode: serverMode
      ? getNotificationDeliveryModeForServerMode(serverMode)
      : null,
    admin_email: resolveAdminEmail(value!),
    admin_whatsapp: resolveAdminWhatsapp(value!),
  };
}

function getModeSyncStatus(serverMode: ServerMode): AdminSettings["sync_status"] {
  return serverMode === "without-server" ? "local" : "synced";
}

function shouldHydrateEditableField(
  current: AdminSettings,
  currentValue: string,
  nextValue: string | null,
  isPlaceholder: (value: string) => boolean,
) {
  if (!nextValue) {
    return false;
  }

  if (current.pending_sync) {
    return false;
  }

  const normalizedCurrentValue = currentValue.trim();

  return (
    !current.setup_completed ||
    normalizedCurrentValue.length === 0 ||
    isPlaceholder(normalizedCurrentValue)
  );
}

function mergeServerAdminSettings(
  currentSettings: AdminSettings,
  serverSettings: NormalizedServerAdminSettings,
  updatedAt: string,
) {
  const nextServerMode = serverSettings.server_mode ?? currentSettings.server_mode;
  const hasModeUpdate = serverSettings.server_mode !== null;
  const nextSettings = normalizeAdminSettings({
    ...currentSettings,
    server_mode: nextServerMode,
    notification_delivery_mode: getNotificationDeliveryModeForServerMode(nextServerMode),
    updated_at: hasModeUpdate ? updatedAt : currentSettings.updated_at,
    updated_by: hasModeUpdate ? "server" : currentSettings.updated_by,
    remote_updated_at: hasModeUpdate ? updatedAt : currentSettings.remote_updated_at,
    pending_sync: currentSettings.pending_sync,
    sync_status: currentSettings.pending_sync
      ? currentSettings.sync_status
      : getModeSyncStatus(nextServerMode),
  });

  if (
    shouldHydrateEditableField(
      currentSettings,
      currentSettings.admin_email,
      serverSettings.admin_email,
      isPlaceholderAdminEmail,
    )
  ) {
    nextSettings.admin_email = serverSettings.admin_email!;
  }

  if (
    shouldHydrateEditableField(
      currentSettings,
      currentSettings.admin_whatsapp,
      serverSettings.admin_whatsapp,
      isPlaceholderAdminPhone,
    )
  ) {
    nextSettings.admin_whatsapp = serverSettings.admin_whatsapp!;
  }

  return normalizeAdminSettings(nextSettings);
}

function persistLocalStorageSettings(
  serverSettings: NormalizedServerAdminSettings,
  updatedAt: string,
) {
  if (!isBrowser()) {
    return;
  }

  const current = normalizeAdminSettings(
    read<AdminSettings>(KEYS.settings, createAdminSettingsFallback()),
  );

  write(KEYS.settings, mergeServerAdminSettings(current, serverSettings, updatedAt));
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

function readNumber(value: unknown, fallback = 587) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function readSyncStatus(value: unknown): AdminSettings["sync_status"] {
  return value === "failed" || value === "synced" || value === "local" || value === "pending"
    ? value
    : "synced";
}

function rowToAdminSettings(row: AdminSettingsSqliteRow): AdminSettings {
  return normalizeAdminSettings({
    id: readString(row.id, SETTINGS_ID),
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

async function readSqliteSettings() {
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
        pending_sync,
        sync_status
      FROM admin_settings
      WHERE id = ?
      LIMIT 1
    `,
    [SETTINGS_ID],
  );

  return rows[0] ? rowToAdminSettings(rows[0]) : createAdminSettingsFallback();
}

async function persistSqliteSettings(
  serverSettings: NormalizedServerAdminSettings,
  updatedAt: string,
) {
  if (import.meta.env.VITE_STORAGE_DRIVER !== "sqlite" || !isTauriRuntime()) {
    return;
  }

  const db = await getDb();
  const next = mergeServerAdminSettings(
    await readSqliteSettings(),
    serverSettings,
    updatedAt,
  );

  await db.execute(
    `
      INSERT INTO admin_settings (
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
        pending_sync,
        sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
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
        pending_sync = excluded.pending_sync,
        sync_status = excluded.sync_status
    `,
    [
      next.id,
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
      next.pending_sync ? 1 : 0,
      next.sync_status,
    ],
  );

  await reloadSqliteCache();
}

export async function persistServerProvidedAdminSettings(
  value: ServerAdminSettingsPayload | null | undefined,
) {
  const serverSettings = normalizeServerAdminSettings(value);

  if (!serverSettings) {
    return;
  }

  const updatedAt = new Date().toISOString();
  persistLocalStorageSettings(serverSettings, updatedAt);

  try {
    await persistSqliteSettings(serverSettings, updatedAt);
  } catch (error) {
    console.error("Server-provided admin settings persistence failed.", error);
    emitChange();
  }
}

export const persistOwnerControlledAdminModes = persistServerProvidedAdminSettings;
