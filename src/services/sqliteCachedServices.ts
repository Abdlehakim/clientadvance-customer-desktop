import type {
  ActivityLog,
  ActivityLogCreateInput,
  AdminSettings,
  AdminSettingsUpdateInput,
  Client,
  ClientCreateInput,
  ClientUpdateInput,
  NotificationCreateInput,
  NotificationItem,
  Payment,
  PaymentCreateInput,
} from "@/domain/types";
import { ensureDefaultAdminUser } from "@/infrastructure/auth/seedDefaultAdmin";
import {
  getCompanySettingsId,
  getCurrentCompanyScope,
  getScopedAppStateKey,
  requireCurrentCompanyScope,
} from "@/infrastructure/auth/currentCompanyScope";
import {
  getCurrentUserSession,
  subscribeCurrentUserSession,
} from "@/infrastructure/auth/currentUserSession";
import type {
  ActivityLogRepository,
  AdminSettingsRepository,
  ClientRepository,
  NotificationRepository,
  PaymentRepository,
  SyncRepository,
  SyncResult,
} from "@/domain/repositories";
import {
  activityLogSQLiteRepository,
  cleanupOldActivityLogs as cleanupSqliteActivityLogs,
} from "@/infrastructure/local/sqlite/activityLogSQLiteRepository";
import { adminSettingsSQLiteRepository } from "@/infrastructure/local/sqlite/adminSettingsSQLiteRepository";
import { clientSQLiteRepository } from "@/infrastructure/local/sqlite/clientSQLiteRepository";
import {
  createAdminSettingsFallback,
  normalizeAdminSettings,
} from "@/infrastructure/local/adminSettingsState";
import { notificationSQLiteRepository } from "@/infrastructure/local/sqlite/notificationSQLiteRepository";
import { paymentSQLiteRepository } from "@/infrastructure/local/sqlite/paymentSQLiteRepository";
import {
  backupDatabase,
  getDb,
  initializeSqliteDatabase,
  resetSqliteInitialization,
  type SqliteDatabaseBackupInfo,
  type SqliteRow,
} from "@/infrastructure/local/sqlite/sqliteClient";
import {
  emitChange,
  isBrowser,
  KEYS,
} from "@/infrastructure/local/localStorageDatabase";
import type {
  SyncRemoteAdminSettings,
  SyncRemoteFailedItem,
  SyncRemoteRequest,
  SyncRemoteResult,
} from "@/infrastructure/remote/syncRemoteService";
import { filterActivityLogsByRetention } from "@/services/activityLogRetention";

function emptySettings(companyScope?: string | null): AdminSettings {
  const fallback = createAdminSettingsFallback();
  return companyScope
    ? { ...fallback, id: getCompanySettingsId(companyScope) }
    : fallback;
}

interface SqliteCacheState {
  initialized: boolean;
  initializePromise: Promise<void> | null;
  initializeScope: string | null;
  companyScope: string | null;
  clients: Client[];
  payments: Payment[];
  settings: AdminSettings;
  logs: ActivityLog[];
  notifications: NotificationItem[];
  lastSync: string | null;
}

const cache: SqliteCacheState = {
  initialized: false,
  initializePromise: null,
  initializeScope: null,
  companyScope: null,
  clients: [],
  payments: [],
  settings: emptySettings(),
  logs: [],
  notifications: [],
  lastSync: null,
};

const LOCAL_STORAGE_MIGRATION_STATUS_KEY = "local_storage_migration_status";

interface SqliteSyncDelegate {
  fullSync(payload: SyncRemoteRequest): Promise<SyncRemoteResult>;
  setOnlineMode(value: boolean): void;
  isOnlineMode(): boolean;
}

interface PendingSyncSnapshot {
  clients: Client[];
  payments: Payment[];
  adminSettings: AdminSettings | null;
  activityLogs: ActivityLog[];
  notifications: NotificationItem[];
}

export const LEGACY_BUSINESS_LOCAL_STORAGE_KEYS = [
  KEYS.clients,
  KEYS.payments,
  KEYS.settings,
  KEYS.logs,
  KEYS.notifications,
  KEYS.localUsers,
  KEYS.offlineCredentials,
  KEYS.smtpPassword,
] as const;

interface ClientRow extends SqliteRow {
  id: unknown;
  nom_complet: unknown;
  telephone: unknown;
  adresse: unknown;
  email: unknown;
  cin: unknown;
  cin_issued_at: unknown;
  birth_date: unknown;
  created_at: unknown;
  updated_at: unknown;
  created_by: unknown;
  updated_by: unknown;
  deleted_at: unknown;
  remote_updated_at: unknown;
  pending_sync: unknown;
  sync_status: unknown;
}

interface PaymentRow extends SqliteRow {
  id: unknown;
  client_id: unknown;
  montant: unknown;
  date_paiement: unknown;
  heure_paiement: unknown;
  created_by: unknown;
  created_at: unknown;
  remote_updated_at: unknown;
  pending_sync: unknown;
  sync_status: unknown;
}

interface AdminSettingsRow extends SqliteRow {
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

interface ActivityLogRow extends SqliteRow {
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

interface NotificationRow extends SqliteRow {
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

interface AppStateRow extends SqliteRow {
  key?: unknown;
  value: unknown;
}

interface TableCountRow extends SqliteRow {
  count: unknown;
}

interface LegacyLocalUserRecord {
  id?: unknown;
  email?: unknown;
  name?: unknown;
  role?: unknown;
  company_id?: unknown;
  company_name?: unknown;
  account_expires_at?: unknown;
  is_active?: unknown;
  offline_enabled?: unknown;
  password_hash?: unknown;
  password_salt?: unknown;
  password_iterations?: unknown;
  display_password?: unknown;
  phone?: unknown;
  phone_normalized?: unknown;
  seeded?: unknown;
  last_online_login_at?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  sync_status?: unknown;
  pending_sync?: unknown;
  sync_action?: unknown;
  deleted_at?: unknown;
}

interface LocalStorageMigrationSnapshot {
  clients: Client[];
  payments: Payment[];
  settings: AdminSettings | null;
  logs: ActivityLog[];
  notifications: NotificationItem[];
  localUsers: LegacyLocalUserRecord[];
  smtpPassword: string | null;
  lastSync: string | null;
}

export interface LocalStorageMigrationStatus {
  status: "skipped" | "success" | "failed";
  migratedAt: string;
  backupPath: string | null;
  counts: {
    clients: number;
    payments: number;
    settings: number;
    activityLogs: number;
    notifications: number;
    localUsers: number;
    smtpPassword: number;
    lastSync: number;
  };
  error?: string;
}

export interface StorageDiagnostics {
  storageDriver: "sqlite";
  tableCounts: Record<string, number>;
  localStorageBusinessDataDetected: boolean;
  localStorageBusinessDataKeys: string[];
  migrationStatus: LocalStorageMigrationStatus | null;
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

function readNumber(value: unknown, fallback = 0) {
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

function readSyncStatus<T extends string>(value: unknown, fallback: T): T {
  return typeof value === "string" ? (value as T) : fallback;
}

function toClient(row: ClientRow): Client {
  return {
    id: readString(row.id),
    nom_complet: readString(row.nom_complet),
    telephone: readString(row.telephone),
    adresse: readString(row.adresse),
    email: readString(row.email),
    cin: readString(row.cin),
    cinIssuedAt: readString(row.cin_issued_at),
    birthDate: readString(row.birth_date),
    created_at: readString(row.created_at),
    updated_at: readString(row.updated_at),
    created_by: readString(row.created_by),
    updated_by: readString(row.updated_by),
    deleted_at: readNullableString(row.deleted_at),
    remote_updated_at: readNullableString(row.remote_updated_at) ?? undefined,
    pending_sync: readBoolean(row.pending_sync),
    sync_status: readSyncStatus(row.sync_status, "pending"),
  };
}

function toPayment(row: PaymentRow): Payment {
  return {
    id: readString(row.id),
    client_id: readString(row.client_id),
    montant: readNumber(row.montant),
    date_paiement: readString(row.date_paiement),
    heure_paiement: readString(row.heure_paiement),
    created_by: readString(row.created_by),
    created_at: readString(row.created_at),
    remote_updated_at: readNullableString(row.remote_updated_at) ?? undefined,
    pending_sync: readBoolean(row.pending_sync),
    sync_status: readSyncStatus(row.sync_status, "pending"),
  };
}

function toAdminSettings(row: AdminSettingsRow, settingsId: string): AdminSettings {
  return normalizeAdminSettings({
    id: readString(row.id, settingsId),
    admin_email: readString(row.admin_email),
    admin_whatsapp: readString(row.admin_whatsapp),
    notification_retention_days: readNumber(row.notification_retention_days, 30),
    setup_completed: readBoolean(row.setup_completed),
    server_mode: readString(row.server_mode),
    notification_delivery_mode: readString(row.notification_delivery_mode),
    smtp_provider_type: readString(row.smtp_provider_type),
    smtp_host: readString(row.smtp_host),
    smtp_port: readNumber(row.smtp_port, 587),
    smtp_username: readString(row.smtp_username),
    smtp_password_configured: readBoolean(row.smtp_password_configured),
    smtp_secure: readBoolean(row.smtp_secure),
    smtp_from_email: readString(row.smtp_from_email),
    smtp_from_name: readString(row.smtp_from_name),
    updated_at: readString(row.updated_at),
    updated_by: readString(row.updated_by),
    remote_updated_at: readNullableString(row.remote_updated_at) ?? undefined,
    pending_sync: readBoolean(row.pending_sync),
    sync_status: readSyncStatus(row.sync_status, "synced"),
  });
}

function toActivityLog(row: ActivityLogRow): ActivityLog {
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
    sync_status: readSyncStatus(row.sync_status, "pending"),
  };
}

function toNotification(row: NotificationRow): NotificationItem {
  const type = readString(row.type) === "whatsapp" ? "whatsapp" : "email";
  const statusValue = readString(row.status, "queued");
  const status =
    statusValue === "sent" || statusValue === "failed" || statusValue === "sending"
      ? statusValue
      : "queued";

  return {
    id: readString(row.id),
    type,
    recipient: readString(row.recipient),
    subject: readString(row.subject),
    body: readString(row.body),
    payment_id: readString(row.payment_id),
    status,
    error_message: readNullableString(row.error_message),
    created_at: readString(row.created_at),
    sent_at: readNullableString(row.sent_at),
    pending_sync: readBoolean(row.pending_sync),
    sync_status: readSyncStatus(row.sync_status, "pending"),
  };
}

async function loadClientsFromSqlite(companyScope: string) {
  const db = await getDb();
  const rows = await db.query<ClientRow>(
    `
      SELECT
        id,
        nom_complet,
        telephone,
        adresse,
        email,
        cin,
        cin_issued_at,
        birth_date,
        created_at,
        updated_at,
        created_by,
        updated_by,
        deleted_at,
        remote_updated_at,
        pending_sync,
        sync_status
      FROM clients
      WHERE company_id = ?
      ORDER BY created_at DESC
    `,
    [companyScope],
  );

  return rows.map(toClient);
}

async function loadPaymentsFromSqlite(companyScope: string) {
  const db = await getDb();
  const rows = await db.query<PaymentRow>(
    `
      SELECT
        id,
        client_id,
        montant,
        date_paiement,
        heure_paiement,
        created_by,
        created_at,
        remote_updated_at,
        pending_sync,
        sync_status
      FROM payments
      WHERE company_id = ?
      ORDER BY created_at DESC
    `,
    [companyScope],
  );

  return rows.map(toPayment);
}

async function loadSettingsFromSqlite(companyScope: string) {
  const settingsId = getCompanySettingsId(companyScope);
  const db = await getDb();
  const rows = await db.query<AdminSettingsRow>(
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
      WHERE company_id = ?
      LIMIT 1
    `,
    [companyScope],
  );

  return rows[0] ? toAdminSettings(rows[0], settingsId) : emptySettings(companyScope);
}

async function loadLogsFromSqlite(companyScope: string) {
  await cleanupSqliteActivityLogs(undefined, companyScope);

  const db = await getDb();
  const rows = await db.query<ActivityLogRow>(
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
}

async function loadNotificationsFromSqlite(companyScope: string) {
  const db = await getDb();
  const rows = await db.query<NotificationRow>(
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
      WHERE company_id = ?
      ORDER BY created_at DESC
    `,
    [companyScope],
  );

  return rows.map(toNotification);
}

async function loadLastSyncFromSqlite(companyScope: string) {
  const stateKey = getScopedAppStateKey("last_sync", companyScope);
  const db = await getDb();
  const rows = await db.query<AppStateRow>(
    `
      SELECT value
      FROM app_state
      WHERE key = ?
      LIMIT 1
    `,
    [stateKey],
  );

  return readNullableString(rows[0]?.value);
}

async function hydrateCacheFromSqlite(companyScope: string) {
  const [clients, payments, settings, logs, notifications, lastSync] = await Promise.all([
    loadClientsFromSqlite(companyScope),
    loadPaymentsFromSqlite(companyScope),
    loadSettingsFromSqlite(companyScope),
    loadLogsFromSqlite(companyScope),
    loadNotificationsFromSqlite(companyScope),
    loadLastSyncFromSqlite(companyScope),
  ]);

  if (cache.companyScope !== companyScope || getCurrentCompanyScope() !== companyScope) {
    return;
  }

  cache.clients = clients;
  cache.payments = payments;
  cache.settings = settings;
  cache.logs = logs;
  cache.notifications = notifications;
  cache.lastSync = lastSync;
  cache.initialized = true;
}

async function refreshClients(companyScope: string) {
  const clients = await loadClientsFromSqlite(companyScope);
  if (cache.companyScope === companyScope) cache.clients = clients;
}

async function refreshPayments(companyScope: string) {
  const payments = await loadPaymentsFromSqlite(companyScope);
  if (cache.companyScope === companyScope) cache.payments = payments;
}

async function refreshSettings(companyScope: string) {
  const settings = await loadSettingsFromSqlite(companyScope);
  if (cache.companyScope === companyScope) cache.settings = settings;
}

async function refreshLogs(companyScope: string) {
  const logs = await loadLogsFromSqlite(companyScope);
  if (cache.companyScope === companyScope) cache.logs = logs;
}

async function refreshNotifications(companyScope: string) {
  const notifications = await loadNotificationsFromSqlite(companyScope);
  if (cache.companyScope === companyScope) cache.notifications = notifications;
}

function visibleClients() {
  return cache.clients.filter((client) => !client.deleted_at);
}

function isPendingSync(item: { pending_sync?: boolean; sync_status?: string }) {
  return item.pending_sync === true || item.sync_status === "pending" || item.sync_status === "failed";
}

function isPendingLog(item: ActivityLog) {
  return item.pending_sync !== false;
}

function isPendingNotification(item: NotificationItem) {
  return isPendingSync(item);
}

function getCachePendingBreakdown() {
  const clients = cache.clients.filter(isPendingSync).length;
  const payments = cache.payments.filter(isPendingSync).length;
  const adminSettings = isPendingSync(cache.settings) ? 1 : 0;
  const activityLogs = cache.logs.filter(isPendingLog).length;
  const notifications = cache.notifications.filter(isPendingNotification).length;

  return {
    clients,
    payments,
    adminSettings,
    activityLogs,
    notifications,
    total: clients + payments + adminSettings + activityLogs + notifications,
  };
}

function shouldPushNotification(notification: NotificationItem) {
  if (!isPendingNotification(notification)) {
    return false;
  }

  return !(
    cache.settings.notification_delivery_mode === "desktop-email" &&
    notification.type === "email" &&
    notification.status !== "sent" &&
    notification.status !== "failed"
  );
}

function collectPendingSyncSnapshot(): PendingSyncSnapshot {
  return {
    clients: cache.clients.filter(isPendingSync).map((client) => ({ ...client })),
    payments: cache.payments.filter(isPendingSync).map((payment) => ({ ...payment })),
    adminSettings: isPendingSync(cache.settings) ? { ...cache.settings } : null,
    activityLogs: cache.logs.filter(isPendingLog).map((log) => ({ ...log })),
    notifications: cache.notifications
      .filter(shouldPushNotification)
      .map((notification) => ({ ...notification })),
  };
}

export async function initializeSqliteCache() {
  await initializeSqliteDatabase();

  const companyScope = getCurrentCompanyScope();

  if (!companyScope) {
    clearCacheForCompanyScope(null);
    return;
  }

  if (cache.companyScope !== companyScope) {
    clearCacheForCompanyScope(companyScope);
  }

  if (cache.initialized && cache.companyScope === companyScope) {
    return;
  }

  if (cache.initializePromise && cache.initializeScope === companyScope) {
    return cache.initializePromise;
  }

  const initializePromise = (async () => {
    await importLocalStorageSnapshotToSqlite(companyScope);
    await ensureDefaultAdminUser();
    await claimLegacyBusinessDataForCompany(companyScope);
    await hydrateCacheFromSqlite(companyScope);
    if (cache.companyScope === companyScope) {
      emitChange();
    }
  })().finally(() => {
    if (cache.initializePromise === initializePromise) {
      cache.initializePromise = null;
      cache.initializeScope = null;
    }
  });
  cache.initializePromise = initializePromise;
  cache.initializeScope = companyScope;

  return initializePromise;
}

export async function reloadSqliteCache() {
  const companyScope = requireCurrentCompanyScope();
  clearCacheForCompanyScope(companyScope);
  resetSqliteInitialization();
  await initializeSqliteCache();
}

function clearCacheForCompanyScope(companyScope: string | null) {
  cache.initialized = false;
  cache.initializePromise = null;
  cache.initializeScope = null;
  cache.companyScope = companyScope;
  cache.clients = [];
  cache.payments = [];
  cache.settings = emptySettings(companyScope);
  cache.logs = [];
  cache.notifications = [];
  cache.lastSync = null;
}

function emitCacheChange() {
  emitChange();
}

subscribeCurrentUserSession(() => {
  const companyScope = getCurrentCompanyScope();
  clearCacheForCompanyScope(companyScope);
  emitCacheChange();

  if (companyScope) {
    void initializeSqliteCache().catch(() => undefined);
  }
});

function resetSettingsSyncStatus(settings: AdminSettings) {
  return settings.server_mode === "without-server" ? "local" : "synced";
}

function localStorageJson<T>(key: string, fallback: T) {
  if (!isBrowser()) {
    return fallback;
  }

  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function localStorageLastSync() {
  if (!isBrowser()) {
    return null;
  }

  const raw = localStorage.getItem(KEYS.lastSync);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return raw;
  }
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isNonEmptyArrayKey(key: string) {
  return localStorageJson<unknown[]>(key, []).length > 0;
}

function hasCustomizedSettings() {
  const settings = localStorageJson<Partial<AdminSettings> | null>(KEYS.settings, null);

  if (!settings) {
    return false;
  }

  return Boolean(
    settings.setup_completed ||
      readOptionalString(settings.admin_email) ||
      readOptionalString(settings.admin_whatsapp) ||
      readOptionalString(settings.smtp_host) ||
      readOptionalString(settings.smtp_username) ||
      readOptionalString(settings.smtp_from_email) ||
      settings.pending_sync === true ||
      settings.sync_status === "pending" ||
      settings.sync_status === "failed",
  );
}

function hasLegacyLocalStorageValue(key: string) {
  if (!isBrowser() || localStorage.getItem(key) === null) {
    return false;
  }

  if (
    key === KEYS.clients ||
    key === KEYS.payments ||
    key === KEYS.logs ||
    key === KEYS.notifications ||
    key === KEYS.localUsers ||
    key === KEYS.offlineCredentials
  ) {
    return isNonEmptyArrayKey(key);
  }

  if (key === KEYS.settings) {
    return hasCustomizedSettings();
  }

  if (key === KEYS.lastSync) {
    return localStorageLastSync() !== null;
  }

  if (key === KEYS.smtpPassword) {
    return readOptionalString(localStorageJson<unknown>(key, null)) !== null;
  }

  return false;
}

function getLegacyLocalStorageDataKeys() {
  if (!isBrowser()) {
    return [];
  }

  return LEGACY_BUSINESS_LOCAL_STORAGE_KEYS.filter(hasLegacyLocalStorageValue);
}

function readLocalStorageMigrationSnapshot(): LocalStorageMigrationSnapshot {
  const localUsers = localStorageJson<LegacyLocalUserRecord[]>(KEYS.localUsers, []);
  const legacyOfflineUsers = localStorageJson<LegacyLocalUserRecord[]>(
    KEYS.offlineCredentials,
    [],
  );
  const usersByEmail = new Map<string, LegacyLocalUserRecord>();

  for (const user of [...legacyOfflineUsers, ...localUsers]) {
    const email = readString(user.email).trim().toLowerCase();

    if (email) {
      usersByEmail.set(email, user);
    }
  }

  return {
    clients: localStorageJson<Client[]>(KEYS.clients, []),
    payments: localStorageJson<Payment[]>(KEYS.payments, []),
    settings: isBrowser() && localStorage.getItem(KEYS.settings) !== null
      ? normalizeAdminSettings(localStorageJson<AdminSettings>(KEYS.settings, emptySettings()))
      : null,
    logs: localStorageJson<ActivityLog[]>(KEYS.logs, []),
    notifications: localStorageJson<NotificationItem[]>(KEYS.notifications, []),
    localUsers: Array.from(usersByEmail.values()),
    smtpPassword: readOptionalString(localStorageJson<unknown>(KEYS.smtpPassword, null)),
    lastSync: localStorageLastSync(),
  };
}

function getMigrationCounts(snapshot: LocalStorageMigrationSnapshot) {
  return {
    clients: snapshot.clients.length,
    payments: snapshot.payments.length,
    settings: snapshot.settings ? 1 : 0,
    activityLogs: snapshot.logs.length,
    notifications: snapshot.notifications.length,
    localUsers: snapshot.localUsers.length,
    smtpPassword: snapshot.smtpPassword ? 1 : 0,
    lastSync: snapshot.lastSync ? 1 : 0,
  };
}

function hasMigrationData(snapshot: LocalStorageMigrationSnapshot) {
  const counts = getMigrationCounts(snapshot);
  return Object.values(counts).some((count) => count > 0);
}

async function writeMigrationStatus(
  status: LocalStorageMigrationStatus,
  companyScope: string,
) {
  const stateKey = getScopedAppStateKey(
    LOCAL_STORAGE_MIGRATION_STATUS_KEY,
    companyScope,
  );
  const db = await getDb();
  await db.execute(
    `
      INSERT INTO app_state (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `,
    [stateKey, JSON.stringify(status)],
  );
}

async function readMigrationStatus(companyScope: string) {
  const stateKey = getScopedAppStateKey(
    LOCAL_STORAGE_MIGRATION_STATUS_KEY,
    companyScope,
  );
  const db = await getDb();
  const rows = await db.query<AppStateRow>(
    `
      SELECT value
      FROM app_state
      WHERE key = ?
      LIMIT 1
    `,
    [stateKey],
  );
  const serialized = readNullableString(rows[0]?.value);

  if (!serialized) {
    return null;
  }

  try {
    return JSON.parse(serialized) as LocalStorageMigrationStatus;
  } catch {
    return null;
  }
}

async function upsertClients(clients: Client[], companyScope: string) {
  const db = await getDb();

  for (const client of clients) {
    await db.execute(
      `
        INSERT INTO clients (
          id,
          company_id,
          nom_complet,
          telephone,
          adresse,
          email,
          cin,
          cin_issued_at,
          birth_date,
          created_at,
          updated_at,
          created_by,
          updated_by,
          deleted_at,
          remote_updated_at,
          pending_sync,
          sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          nom_complet = excluded.nom_complet,
          telephone = excluded.telephone,
          adresse = excluded.adresse,
          email = excluded.email,
          cin = excluded.cin,
          cin_issued_at = excluded.cin_issued_at,
          birth_date = excluded.birth_date,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          created_by = excluded.created_by,
          updated_by = excluded.updated_by,
          deleted_at = excluded.deleted_at,
          remote_updated_at = excluded.remote_updated_at,
          pending_sync = excluded.pending_sync,
          sync_status = excluded.sync_status
        WHERE clients.company_id = excluded.company_id
      `,
      [
        client.id,
        companyScope,
        client.nom_complet,
        client.telephone,
        client.adresse,
        client.email,
        client.cin,
        client.cinIssuedAt ?? "",
        client.birthDate ?? "",
        client.created_at,
        client.updated_at,
        client.created_by,
        client.updated_by,
        client.deleted_at ?? null,
        client.remote_updated_at ?? null,
        client.pending_sync ? 1 : 0,
        client.sync_status,
      ],
    );
  }
}

async function upsertPayments(payments: Payment[], companyScope: string) {
  const db = await getDb();

  for (const payment of payments) {
    await db.execute(
      `
        INSERT INTO payments (
          id,
          company_id,
          client_id,
          montant,
          date_paiement,
          heure_paiement,
          created_by,
          created_at,
          remote_updated_at,
          pending_sync,
          sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          client_id = excluded.client_id,
          montant = excluded.montant,
          date_paiement = excluded.date_paiement,
          heure_paiement = excluded.heure_paiement,
          created_by = excluded.created_by,
          created_at = excluded.created_at,
          remote_updated_at = excluded.remote_updated_at,
          pending_sync = excluded.pending_sync,
          sync_status = excluded.sync_status
        WHERE payments.company_id = excluded.company_id
      `,
      [
        payment.id,
        companyScope,
        payment.client_id,
        payment.montant,
        payment.date_paiement,
        payment.heure_paiement,
        payment.created_by,
        payment.created_at,
        payment.remote_updated_at ?? null,
        payment.pending_sync ? 1 : 0,
        payment.sync_status,
      ],
    );
  }
}

async function upsertSettings(settings: AdminSettings, companyScope: string) {
  const settingsId = getCompanySettingsId(companyScope);
  const db = await getDb();
  await db.execute(
    `
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
        pending_sync,
        sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        pending_sync = excluded.pending_sync,
        sync_status = excluded.sync_status
      WHERE admin_settings.company_id = excluded.company_id
    `,
    [
      settingsId,
      companyScope,
      settings.admin_email,
      settings.admin_whatsapp,
      settings.notification_retention_days,
      settings.setup_completed ? 1 : 0,
      settings.server_mode,
      settings.notification_delivery_mode,
      settings.smtp_provider_type,
      settings.smtp_host,
      settings.smtp_port,
      settings.smtp_username,
      settings.smtp_password_configured ? 1 : 0,
      settings.smtp_secure ? 1 : 0,
      settings.smtp_from_email,
      settings.smtp_from_name,
      settings.updated_at,
      settings.updated_by ?? "",
      settings.remote_updated_at ?? null,
      settings.pending_sync ? 1 : 0,
      settings.sync_status,
    ],
  );
}

async function upsertLogs(logs: ActivityLog[], companyScope: string) {
  const db = await getDb();

  for (const log of filterActivityLogsByRetention(logs)) {
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
        ON CONFLICT(id) DO UPDATE SET
          user_id = excluded.user_id,
          user_name = excluded.user_name,
          action_type = excluded.action_type,
          description = excluded.description,
          entity_type = excluded.entity_type,
          entity_id = excluded.entity_id,
          created_at = excluded.created_at,
          pending_sync = excluded.pending_sync,
          sync_status = excluded.sync_status
        WHERE activity_logs.company_id = excluded.company_id
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
        log.pending_sync !== false ? 1 : 0,
        log.sync_status ?? "pending",
      ],
    );
  }
}

async function upsertNotifications(notifications: NotificationItem[], companyScope: string) {
  const db = await getDb();

  for (const notification of notifications) {
    await db.execute(
      `
        INSERT INTO notification_queue (
          id,
          company_id,
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          recipient = excluded.recipient,
          subject = excluded.subject,
          body = excluded.body,
          payment_id = excluded.payment_id,
          status = excluded.status,
          error_message = excluded.error_message,
          created_at = excluded.created_at,
          sent_at = excluded.sent_at,
          pending_sync = excluded.pending_sync,
          sync_status = excluded.sync_status
        WHERE notification_queue.company_id = excluded.company_id
      `,
      [
        notification.id,
        companyScope,
        notification.type,
        notification.recipient,
        notification.subject,
        notification.body,
        notification.payment_id,
        notification.status ?? "queued",
        notification.error_message ?? null,
        notification.created_at,
        notification.sent_at ?? null,
        notification.pending_sync ? 1 : 0,
        notification.sync_status ?? "pending",
      ],
    );
  }
}

async function writeLastSync(lastSync: string | null, companyScope: string) {
  const stateKey = getScopedAppStateKey("last_sync", companyScope);
  const db = await getDb();
  await db.execute(
    `
      INSERT INTO app_state (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `,
    [stateKey, lastSync],
  );
}

async function mergeRemoteAdminSettings(
  remoteSettings: SyncRemoteAdminSettings | null,
  companyScope: string,
) {
  if (!remoteSettings) {
    return;
  }

  const current = await loadSettingsFromSqlite(companyScope);
  const next: AdminSettings = {
    ...current,
    admin_email:
      typeof remoteSettings.admin_email === "string"
        ? remoteSettings.admin_email
        : current.admin_email,
    admin_whatsapp:
      typeof remoteSettings.admin_whatsapp === "string"
        ? remoteSettings.admin_whatsapp
        : current.admin_whatsapp,
    updated_at:
      typeof remoteSettings.updated_at === "string"
        ? remoteSettings.updated_at
        : current.updated_at,
    updated_by:
      typeof remoteSettings.updated_by === "string"
        ? remoteSettings.updated_by
        : current.updated_by,
    remote_updated_at:
      typeof remoteSettings.remote_updated_at === "string"
        ? remoteSettings.remote_updated_at
        : current.remote_updated_at,
    pending_sync: false,
    sync_status: "synced",
  };

  await upsertSettings(next, companyScope);
}

async function applyRemoteSyncData(result: SyncRemoteResult, companyScope: string) {
  await upsertClients(
    result.clients.map((client) => ({
      ...client,
      cinIssuedAt: client.cinIssuedAt ?? "",
      birthDate: client.birthDate ?? "",
      deleted_at: client.deleted_at ?? null,
      pending_sync: false,
      sync_status: "synced" as const,
    })),
    companyScope,
  );
  await upsertPayments(
    result.payments.map((payment) => ({
      ...payment,
      pending_sync: false,
      sync_status: "synced" as const,
    })),
    companyScope,
  );
  await mergeRemoteAdminSettings(result.adminSettings, companyScope);
  await upsertLogs(
    result.activityLogs.map((log) => ({
      ...log,
      pending_sync: false,
      sync_status: "synced" as const,
    })),
    companyScope,
  );
  await upsertNotifications(
    result.notifications.map((notification) => ({
      ...notification,
      pending_sync: false,
      sync_status: "synced" as const,
    })),
    companyScope,
  );
}

function getFailedIds(
  failedItems: SyncRemoteFailedItem[],
  entity: SyncRemoteFailedItem["entity"],
) {
  return new Set(
    failedItems
      .filter((item) => item.entity === entity && item.id)
      .map((item) => item.id as string),
  );
}

async function markEntitySyncResults(
  table: "clients" | "payments" | "activity_logs" | "notification_queue",
  ids: string[],
  failedIds: Set<string>,
  companyScope: string,
) {
  const db = await getDb();

  for (const id of ids) {
    const failed = failedIds.has(id);
    await db.execute(
      `
        UPDATE ${table}
        SET
          pending_sync = ?,
          sync_status = ?
        WHERE id = ?
          AND company_id = ?
      `,
      [failed ? 1 : 0, failed ? "failed" : "synced", id, companyScope],
    );
  }
}

async function markPushedSyncResults(
  snapshot: PendingSyncSnapshot,
  failedItems: SyncRemoteFailedItem[],
  companyScope: string,
) {
  await markEntitySyncResults(
    "clients",
    snapshot.clients.map((client) => client.id),
    getFailedIds(failedItems, "client"),
    companyScope,
  );
  await markEntitySyncResults(
    "payments",
    snapshot.payments.map((payment) => payment.id),
    getFailedIds(failedItems, "payment"),
    companyScope,
  );

  if (snapshot.adminSettings) {
    const settingsFailed = failedItems.some((item) => item.entity === "adminSettings");
    const db = await getDb();
    await db.execute(
      `
        UPDATE admin_settings
        SET
          pending_sync = ?,
          sync_status = ?
        WHERE id = ?
          AND company_id = ?
      `,
      [
        settingsFailed ? 1 : 0,
        settingsFailed ? "failed" : "synced",
        snapshot.adminSettings.id,
        companyScope,
      ],
    );
  }

  await markEntitySyncResults(
    "activity_logs",
    snapshot.activityLogs.map((log) => log.id),
    getFailedIds(failedItems, "activityLog"),
    companyScope,
  );
  await markEntitySyncResults(
    "notification_queue",
    snapshot.notifications.map((notification) => notification.id),
    getFailedIds(failedItems, "notification"),
    companyScope,
  );
}

function totalSynced(result: SyncRemoteResult["synced"]) {
  return (
    result.clients +
    result.payments +
    result.adminSettings +
    result.activityLogs +
    result.notifications
  );
}

function normalizeLegacyUser(record: LegacyLocalUserRecord) {
  const now = new Date().toISOString();
  const id = readString(record.id).trim();
  const email = readString(record.email).trim().toLowerCase();
  const name = readString(record.name).trim();

  if (!id || !email || !name) {
    return null;
  }

  const passwordHash = readString(record.password_hash);
  const role = readString(record.role) === "employe" ? "employe" : "admin";
  const syncStatus = readString(record.sync_status) === "synced" ? "synced" : "local";
  const syncAction = ["create", "update", "delete"].includes(readString(record.sync_action))
    ? readString(record.sync_action)
    : "none";

  return {
    id,
    email,
    name,
    role,
    company_id: readNullableString(record.company_id),
    company_name: readNullableString(record.company_name),
    account_expires_at: readNullableString(record.account_expires_at),
    is_active: readBoolean(record.is_active, true),
    offline_enabled: readBoolean(record.offline_enabled, passwordHash.length > 0),
    password_hash: passwordHash,
    password_salt: readString(record.password_salt),
    password_iterations: Math.max(1, Math.trunc(readNumber(record.password_iterations, 120000))),
    display_password: readString(record.display_password),
    phone: readString(record.phone),
    phone_normalized: readString(record.phone_normalized),
    seeded: readBoolean(record.seeded, false),
    last_online_login_at: readNullableString(record.last_online_login_at),
    created_at: readString(record.created_at, now),
    updated_at: readString(record.updated_at, now),
    sync_status: syncStatus,
    pending_sync: readBoolean(record.pending_sync, false),
    sync_action: syncAction,
    deleted_at: readNullableString(record.deleted_at),
  };
}

async function upsertLocalUsers(records: LegacyLocalUserRecord[]) {
  const db = await getDb();

  for (const record of records) {
    const user = normalizeLegacyUser(record);

    if (!user) {
      continue;
    }

    await db.execute(
      `
        INSERT INTO local_users (
          id,
          email,
          name,
          role,
          company_id,
          company_name,
          account_expires_at,
          is_active,
          offline_enabled,
          password_hash,
          password_salt,
          password_iterations,
          display_password,
          phone,
          phone_normalized,
          seeded,
          last_online_login_at,
          created_at,
          updated_at,
          sync_status,
          pending_sync,
          sync_action,
          deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
          id = excluded.id,
          name = excluded.name,
          role = excluded.role,
          company_id = excluded.company_id,
          company_name = excluded.company_name,
          account_expires_at = excluded.account_expires_at,
          is_active = excluded.is_active,
          offline_enabled = excluded.offline_enabled,
          password_hash = excluded.password_hash,
          password_salt = excluded.password_salt,
          password_iterations = excluded.password_iterations,
          display_password = excluded.display_password,
          phone = excluded.phone,
          phone_normalized = excluded.phone_normalized,
          seeded = excluded.seeded,
          last_online_login_at = excluded.last_online_login_at,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          sync_status = excluded.sync_status,
          pending_sync = excluded.pending_sync,
          sync_action = excluded.sync_action,
          deleted_at = excluded.deleted_at
      `,
      [
        user.id,
        user.email,
        user.name,
        user.role,
        user.company_id,
        user.company_name,
        user.account_expires_at,
        user.is_active ? 1 : 0,
        user.offline_enabled ? 1 : 0,
        user.password_hash,
        user.password_salt,
        user.password_iterations,
        user.display_password,
        user.phone,
        user.phone_normalized,
        user.seeded ? 1 : 0,
        user.last_online_login_at,
        user.created_at,
        user.updated_at,
        user.sync_status,
        user.pending_sync ? 1 : 0,
        user.sync_action,
        user.deleted_at,
      ],
    );
  }
}

async function writeAppStateValue(key: string, value: string | null) {
  const db = await getDb();
  await db.execute(
    `
      INSERT INTO app_state (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `,
    [key, value],
  );
}

interface CompanyScopeRow extends SqliteRow {
  company_id: unknown;
}

async function canClaimLegacyBusinessData(companyScope: string) {
  const authenticatedCompanyId = getCurrentUserSession()?.company_id?.trim();
  if (!authenticatedCompanyId || authenticatedCompanyId !== companyScope) {
    return false;
  }

  const db = await getDb();
  const rows = await db.query<CompanyScopeRow>(
    `
      SELECT DISTINCT TRIM(company_id) AS company_id
      FROM local_users
      WHERE company_id IS NOT NULL
        AND TRIM(company_id) <> ''
    `,
  );
  const companyIds = rows
    .map((row) => readString(row.company_id).trim())
    .filter(Boolean);

  return companyIds.length === 1 && companyIds[0] === companyScope;
}

async function claimLegacyBusinessDataForCompany(companyScope: string) {
  if (!(await canClaimLegacyBusinessData(companyScope))) {
    return;
  }

  const db = await getDb();
  const settingsId = getCompanySettingsId(companyScope);
  const lastSyncKey = getScopedAppStateKey("last_sync", companyScope);
  const smtpPasswordKey = getScopedAppStateKey("smtp_password", companyScope);

  await db.execute("UPDATE clients SET company_id = ? WHERE company_id IS NULL", [companyScope]);
  await db.execute("UPDATE payments SET company_id = ? WHERE company_id IS NULL", [companyScope]);
  await db.execute(
    `
      UPDATE admin_settings
      SET id = ?, company_id = ?
      WHERE company_id IS NULL
        AND (SELECT COUNT(*) FROM admin_settings WHERE company_id IS NULL) = 1
        AND NOT EXISTS (
          SELECT 1
          FROM admin_settings
          WHERE company_id = ? OR id = ?
        )
    `,
    [settingsId, companyScope, companyScope, settingsId],
  );
  await db.execute("UPDATE activity_logs SET company_id = ? WHERE company_id IS NULL", [companyScope]);
  await db.execute("UPDATE notification_queue SET company_id = ? WHERE company_id IS NULL", [companyScope]);

  await db.execute(
    `
      INSERT INTO app_state (key, value, updated_at)
      SELECT ?, value, CURRENT_TIMESTAMP
      FROM app_state
      WHERE key = 'last_sync'
        AND NOT EXISTS (SELECT 1 FROM app_state WHERE key = ?)
      LIMIT 1
    `,
    [lastSyncKey, lastSyncKey],
  );
  await db.execute(
    `
      INSERT INTO app_state (key, value, updated_at)
      SELECT ?, value, CURRENT_TIMESTAMP
      FROM app_state
      WHERE key = 'smtp_password'
        AND NOT EXISTS (SELECT 1 FROM app_state WHERE key = ?)
      LIMIT 1
    `,
    [smtpPasswordKey, smtpPasswordKey],
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Erreur inconnue";
}

async function importLocalStorageSnapshotToSqlite(companyScope: string) {
  const existingStatus = await readMigrationStatus(companyScope);

  if (existingStatus?.status === "success") {
    return;
  }

  const snapshot = readLocalStorageMigrationSnapshot();

  if (!hasMigrationData(snapshot)) {
    await writeMigrationStatus({
      status: "skipped",
      migratedAt: new Date().toISOString(),
      backupPath: null,
      counts: getMigrationCounts(snapshot),
    }, companyScope);
    return;
  }

  let backup: SqliteDatabaseBackupInfo | null = null;
  const counts = getMigrationCounts(snapshot);

  try {
    backup = await backupDatabase();
    await upsertLocalUsers(snapshot.localUsers);
    const canClaimBusinessData = await canClaimLegacyBusinessData(companyScope);

    if (canClaimBusinessData) {
      await upsertClients(snapshot.clients, companyScope);
      await upsertPayments(snapshot.payments, companyScope);

      if (snapshot.settings) {
        await upsertSettings(snapshot.settings, companyScope);
      }

      await upsertLogs(snapshot.logs, companyScope);
      await upsertNotifications(snapshot.notifications, companyScope);
      if (snapshot.smtpPassword) {
        await writeAppStateValue(
          getScopedAppStateKey("smtp_password", companyScope),
          snapshot.smtpPassword,
        );
      }

      if (snapshot.lastSync) {
        await writeLastSync(snapshot.lastSync, companyScope);
      }
    }

    await writeMigrationStatus({
      status: "success",
      migratedAt: new Date().toISOString(),
      backupPath: backup.path,
      counts,
    }, companyScope);
  } catch (error) {
    await writeMigrationStatus({
      status: "failed",
      migratedAt: new Date().toISOString(),
      backupPath: backup?.path ?? null,
      counts,
      error: errorMessage(error),
    }, companyScope);
    throw error;
  }
}

export async function resetSqliteDevelopmentData() {
  await initializeSqliteCache();

  const companyScope = requireCurrentCompanyScope();
  const lastSyncKey = getScopedAppStateKey("last_sync", companyScope);
  const db = await getDb();
  const settings = normalizeAdminSettings(cache.settings);

  await db.execute("DELETE FROM notification_queue WHERE company_id = ?", [companyScope]);
  await db.execute("DELETE FROM activity_logs WHERE company_id = ?", [companyScope]);
  await db.execute("DELETE FROM payments WHERE company_id = ?", [companyScope]);
  await db.execute("DELETE FROM clients WHERE company_id = ?", [companyScope]);
  await db.execute(
    "DELETE FROM local_users WHERE role = 'employe' AND company_id = ?",
    [companyScope],
  );
  await db.execute("DELETE FROM app_state WHERE key = ?", [lastSyncKey]);
  await db.execute(
    `
      UPDATE admin_settings
      SET pending_sync = 0,
          sync_status = ?
      WHERE company_id = ?
    `,
    [resetSettingsSyncStatus(settings), companyScope],
  );

  await hydrateCacheFromSqlite(companyScope);
  emitCacheChange();
}

const COMPANY_SCOPED_TABLES = new Set([
  "clients",
  "payments",
  "admin_settings",
  "activity_logs",
  "notification_queue",
]);

async function getTableCount(tableName: string, companyScope: string) {
  const db = await getDb();
  const rows = COMPANY_SCOPED_TABLES.has(tableName)
    ? await db.query<TableCountRow>(
        `SELECT COUNT(*) AS count FROM ${tableName} WHERE company_id = ?`,
        [companyScope],
      )
    : await db.query<TableCountRow>(`SELECT COUNT(*) AS count FROM ${tableName}`);
  return readNumber(rows[0]?.count, 0);
}

export async function getSqliteStorageDiagnostics(): Promise<StorageDiagnostics> {
  await initializeSqliteCache();
  const companyScope = requireCurrentCompanyScope();

  const tableNames = [
    "clients",
    "payments",
    "admin_settings",
    "activity_logs",
    "notification_queue",
    "local_users",
    "app_state",
  ];
  const counts = await Promise.all(
    tableNames.map((tableName) => getTableCount(tableName, companyScope)),
  );
  const tableCounts = Object.fromEntries(
    tableNames.map((tableName, index) => [tableName, counts[index]]),
  );
  const localStorageBusinessDataKeys = getLegacyLocalStorageDataKeys();

  return {
    storageDriver: "sqlite",
    tableCounts,
    localStorageBusinessDataDetected: localStorageBusinessDataKeys.length > 0,
    localStorageBusinessDataKeys,
    migrationStatus: await readMigrationStatus(companyScope),
  };
}

export async function cleanupLegacyLocalStorageData() {
  await initializeSqliteCache();

  if (!isBrowser()) {
    return [] as string[];
  }

  const removedKeys = getLegacyLocalStorageDataKeys();

  for (const key of LEGACY_BUSINESS_LOCAL_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }

  emitChange();
  return removedKeys;
}

export const sqliteCachedClientService: ClientRepository = {
  getAll() {
    return visibleClients();
  },
  getById(id) {
    return cache.clients.find((client) => client.id === id && !client.deleted_at) ?? null;
  },
  async create(input) {
    await initializeSqliteCache();
    const client = await clientSQLiteRepository.create(input as ClientCreateInput);
    await Promise.all([refreshClients(), refreshLogs()]);
    emitCacheChange();
    return client as Client;
  },
  async update(id, patch) {
    await initializeSqliteCache();
    await clientSQLiteRepository.update(id, patch as ClientUpdateInput);
    await Promise.all([refreshClients(), refreshLogs()]);
    emitCacheChange();
  },
  async delete(id) {
    await initializeSqliteCache();
    await clientSQLiteRepository.delete(id);
    await Promise.all([refreshClients(), refreshLogs()]);
    emitCacheChange();
  },
};

export const sqliteCachedPaymentService: PaymentRepository = {
  getAll() {
    return cache.payments;
  },
  getByClientId(clientId) {
    return cache.payments.filter((payment) => payment.client_id === clientId);
  },
  async create(input) {
    await initializeSqliteCache();
    const payment = await paymentSQLiteRepository.create(input as PaymentCreateInput);
    await Promise.all([refreshPayments(), refreshLogs(), refreshNotifications()]);
    emitCacheChange();
    return payment as Payment;
  },
  async delete(id) {
    await initializeSqliteCache();
    await paymentSQLiteRepository.delete(id);
    await Promise.all([refreshPayments(), refreshLogs(), refreshNotifications()]);
    emitCacheChange();
  },
};

export const sqliteCachedAdminSettingsService: AdminSettingsRepository = {
  get() {
    return cache.settings;
  },
  async update(patch) {
    await initializeSqliteCache();
    await adminSettingsSQLiteRepository.update(patch as AdminSettingsUpdateInput);
    await Promise.all([refreshSettings(), refreshLogs()]);
    emitCacheChange();
  },
};

export const sqliteCachedActivityLogService: ActivityLogRepository = {
  getAll() {
    return filterActivityLogsByRetention(cache.logs);
  },
  async create(input) {
    await initializeSqliteCache();
    const log = await activityLogSQLiteRepository.create(input as ActivityLogCreateInput);
    await refreshLogs();
    emitCacheChange();
    return log as ActivityLog;
  },
};

export const sqliteCachedNotificationService: NotificationRepository = {
  getAll() {
    return cache.notifications;
  },
  async create(input) {
    await initializeSqliteCache();
    const notification = await notificationSQLiteRepository.create(input as NotificationCreateInput);
    await refreshNotifications();
    emitCacheChange();
    return notification as NotificationItem;
  },
  async markAsSending(id) {
    await initializeSqliteCache();
    await notificationSQLiteRepository.markAsSending(id);
    await refreshNotifications();
    emitCacheChange();
  },
  async markAsSent(id) {
    await initializeSqliteCache();
    await notificationSQLiteRepository.markAsSent(id);
    await refreshNotifications();
    emitCacheChange();
  },
  async markAsFailed(id, errorMessage) {
    await initializeSqliteCache();
    await notificationSQLiteRepository.markAsFailed(id, errorMessage);
    await refreshNotifications();
    emitCacheChange();
  },
  async clearSent(options) {
    await initializeSqliteCache();
    const deletedCount = await notificationSQLiteRepository.clearSent(options);

    if (deletedCount > 0) {
      await refreshNotifications();
      emitCacheChange();
    }

    return deletedCount;
  },
};

export function createSqliteCachedSyncService(syncDelegate: SqliteSyncDelegate): SyncRepository {
  return {
    getPendingCount() {
      return getCachePendingBreakdown().total;
    },
    getLastSync() {
      return cache.lastSync;
    },
    setOnlineMode(value) {
      syncDelegate.setOnlineMode(value);
    },
    isOnlineMode() {
      return syncDelegate.isOnlineMode();
    },
    async syncPendingData(): Promise<SyncResult> {
      await initializeSqliteCache();

      if (!syncDelegate.isOnlineMode()) {
        return { ok: false, synced: 0 };
      }

      const snapshot = collectPendingSyncSnapshot();
      const result = await syncDelegate.fullSync({
        ...snapshot,
        ...(cache.lastSync ? { since: cache.lastSync } : {}),
      });

      await applyRemoteSyncData(result);
      await markPushedSyncResults(snapshot, result.failedItems);
      await writeLastSync(result.serverTimestamp);
      await hydrateCacheFromSqlite();
      emitCacheChange();

      return {
        ok: result.success,
        synced: totalSynced(result.synced),
      };
    },
  };
}
