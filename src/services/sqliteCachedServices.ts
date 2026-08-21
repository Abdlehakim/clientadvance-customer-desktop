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
import { filterActivityLogsByRetention } from "@/services/activityLogRetention";

function emptySettings(): AdminSettings {
  return createAdminSettingsFallback();
}

interface SqliteCacheState {
  initialized: boolean;
  initializePromise: Promise<void> | null;
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
  clients: [],
  payments: [],
  settings: emptySettings(),
  logs: [],
  notifications: [],
  lastSync: null,
};

const LOCAL_STORAGE_MIGRATION_STATUS_KEY = "local_storage_migration_status";
const SQLITE_BACKEND_SYNC_UNAVAILABLE_MESSAGE =
  "Synchronisation backend indisponible en mode SQLite tant que la synchronisation native SQLite n'est pas active.";

export const LEGACY_BUSINESS_LOCAL_STORAGE_KEYS = [
  KEYS.clients,
  KEYS.payments,
  KEYS.settings,
  KEYS.logs,
  KEYS.notifications,
  KEYS.localUsers,
  KEYS.offlineCredentials,
  KEYS.smtpPassword,
  KEYS.licenseState,
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

interface LegacyLicenseState {
  id?: unknown;
  license_key_hash?: unknown;
  licenseKeyHash?: unknown;
  license_token?: unknown;
  licenseToken?: unknown;
  device_id?: unknown;
  deviceId?: unknown;
  license_status?: unknown;
  licenseStatus?: unknown;
  company_id?: unknown;
  companyId?: unknown;
  company_name?: unknown;
  companyName?: unknown;
  customer_name?: unknown;
  customerName?: unknown;
  activated_at?: unknown;
  activatedAt?: unknown;
  expires_at?: unknown;
  expiresAt?: unknown;
  last_checked_at?: unknown;
  lastCheckedAt?: unknown;
  last_validated_at?: unknown;
  lastValidatedAt?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
}

interface LocalStorageMigrationSnapshot {
  clients: Client[];
  payments: Payment[];
  settings: AdminSettings | null;
  logs: ActivityLog[];
  notifications: NotificationItem[];
  localUsers: LegacyLocalUserRecord[];
  licenseState: LegacyLicenseState | null;
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
    licenseState: number;
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

function toAdminSettings(row: AdminSettingsRow): AdminSettings {
  return normalizeAdminSettings({
    id: readString(row.id, "settings_default"),
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

async function loadClientsFromSqlite() {
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
      ORDER BY created_at DESC
    `,
  );

  return rows.map(toClient);
}

async function loadPaymentsFromSqlite() {
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
      ORDER BY created_at DESC
    `,
  );

  return rows.map(toPayment);
}

async function loadSettingsFromSqlite() {
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
      WHERE id = 'settings_default'
      LIMIT 1
    `,
  );

  return rows[0] ? toAdminSettings(rows[0]) : emptySettings();
}

async function loadLogsFromSqlite() {
  await cleanupSqliteActivityLogs();

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
      ORDER BY created_at DESC
    `,
  );

  return rows.map(toActivityLog);
}

async function loadNotificationsFromSqlite() {
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
      ORDER BY created_at DESC
    `,
  );

  return rows.map(toNotification);
}

async function loadLastSyncFromSqlite() {
  const db = await getDb();
  const rows = await db.query<AppStateRow>(
    `
      SELECT value
      FROM app_state
      WHERE key = 'last_sync'
      LIMIT 1
    `,
  );

  return readNullableString(rows[0]?.value);
}

async function hydrateCacheFromSqlite() {
  const [clients, payments, settings, logs, notifications, lastSync] = await Promise.all([
    loadClientsFromSqlite(),
    loadPaymentsFromSqlite(),
    loadSettingsFromSqlite(),
    loadLogsFromSqlite(),
    loadNotificationsFromSqlite(),
    loadLastSyncFromSqlite(),
  ]);

  cache.clients = clients;
  cache.payments = payments;
  cache.settings = settings;
  cache.logs = logs;
  cache.notifications = notifications;
  cache.lastSync = lastSync;
  cache.initialized = true;
}

async function refreshClients() {
  cache.clients = await loadClientsFromSqlite();
}

async function refreshPayments() {
  cache.payments = await loadPaymentsFromSqlite();
}

async function refreshSettings() {
  cache.settings = await loadSettingsFromSqlite();
}

async function refreshLogs() {
  cache.logs = await loadLogsFromSqlite();
}

async function refreshNotifications() {
  cache.notifications = await loadNotificationsFromSqlite();
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

export async function initializeSqliteCache() {
  if (cache.initialized) {
    return;
  }

  cache.initializePromise ??= (async () => {
    await initializeSqliteDatabase();
    await importLocalStorageSnapshotToSqlite();
    await ensureDefaultAdminUser();
    await hydrateCacheFromSqlite();
    emitChange();
  })().finally(() => {
    cache.initializePromise = null;
  });

  return cache.initializePromise;
}

export async function reloadSqliteCache() {
  cache.initialized = false;
  cache.initializePromise = null;
  resetSqliteInitialization();
  await initializeSqliteCache();
}

function emitCacheChange() {
  emitChange();
}

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

function readRecordValue(record: Partial<Record<string, unknown>>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
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

  if (key === KEYS.licenseState) {
    const licenseState = localStorageJson<Record<string, unknown> | null>(key, null);
    return licenseState !== null && Object.keys(licenseState).length > 0;
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
    licenseState: localStorageJson<LegacyLicenseState | null>(KEYS.licenseState, null),
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
    licenseState: snapshot.licenseState ? 1 : 0,
    smtpPassword: snapshot.smtpPassword ? 1 : 0,
    lastSync: snapshot.lastSync ? 1 : 0,
  };
}

function hasMigrationData(snapshot: LocalStorageMigrationSnapshot) {
  const counts = getMigrationCounts(snapshot);
  return Object.values(counts).some((count) => count > 0);
}

async function writeMigrationStatus(status: LocalStorageMigrationStatus) {
  const db = await getDb();
  await db.execute(
    `
      INSERT INTO app_state (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `,
    [LOCAL_STORAGE_MIGRATION_STATUS_KEY, JSON.stringify(status)],
  );
}

async function readMigrationStatus() {
  const db = await getDb();
  const rows = await db.query<AppStateRow>(
    `
      SELECT value
      FROM app_state
      WHERE key = ?
      LIMIT 1
    `,
    [LOCAL_STORAGE_MIGRATION_STATUS_KEY],
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

async function upsertClients(clients: Client[]) {
  const db = await getDb();

  for (const client of clients) {
    await db.execute(
      `
        INSERT INTO clients (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      `,
      [
        client.id,
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

async function upsertPayments(payments: Payment[]) {
  const db = await getDb();

  for (const payment of payments) {
    await db.execute(
      `
        INSERT INTO payments (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      `,
      [
        payment.id,
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

async function upsertSettings(settings: AdminSettings) {
  const db = await getDb();
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
      settings.id,
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

async function upsertLogs(logs: ActivityLog[]) {
  const db = await getDb();

  for (const log of filterActivityLogsByRetention(logs)) {
    await db.execute(
      `
        INSERT INTO activity_logs (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      `,
      [
        log.id,
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

async function upsertNotifications(notifications: NotificationItem[]) {
  const db = await getDb();

  for (const notification of notifications) {
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
      `,
      [
        notification.id,
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

async function writeLastSync(lastSync: string | null) {
  const db = await getDb();
  await db.execute(
    `
      INSERT INTO app_state (key, value, updated_at)
      VALUES ('last_sync', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `,
    [lastSync],
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
          id = excluded.id,
          name = excluded.name,
          role = excluded.role,
          company_id = excluded.company_id,
          company_name = excluded.company_name,
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

function normalizeLicenseStatus(value: unknown) {
  return value === "active" ||
    value === "expired" ||
    value === "revoked" ||
    value === "suspended"
    ? value
    : "invalid";
}

function readLicenseValue(record: LegacyLicenseState, ...keys: string[]) {
  return readRecordValue(record as Partial<Record<string, unknown>>, ...keys);
}

async function upsertLicenseState(record: LegacyLicenseState | null) {
  if (!record) {
    return;
  }

  const now = new Date().toISOString();
  const db = await getDb();
  await db.execute(
    `
      INSERT INTO license_state (
        id,
        license_key_hash,
        license_token,
        device_id,
        license_status,
        company_id,
        company_name,
        customer_name,
        activated_at,
        expires_at,
        last_checked_at,
        last_validated_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        license_key_hash = excluded.license_key_hash,
        license_token = excluded.license_token,
        device_id = excluded.device_id,
        license_status = excluded.license_status,
        company_id = excluded.company_id,
        company_name = excluded.company_name,
        customer_name = excluded.customer_name,
        activated_at = excluded.activated_at,
        expires_at = excluded.expires_at,
        last_checked_at = excluded.last_checked_at,
        last_validated_at = excluded.last_validated_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
    [
      readString(readLicenseValue(record, "id"), "primary"),
      readString(readLicenseValue(record, "license_key_hash", "licenseKeyHash")),
      readString(readLicenseValue(record, "license_token", "licenseToken")),
      readString(readLicenseValue(record, "device_id", "deviceId")),
      normalizeLicenseStatus(readLicenseValue(record, "license_status", "licenseStatus")),
      readNullableString(readLicenseValue(record, "company_id", "companyId")),
      readNullableString(readLicenseValue(record, "company_name", "companyName")),
      readNullableString(readLicenseValue(record, "customer_name", "customerName")),
      readString(readLicenseValue(record, "activated_at", "activatedAt"), now),
      readNullableString(readLicenseValue(record, "expires_at", "expiresAt")),
      readNullableString(readLicenseValue(record, "last_checked_at", "lastCheckedAt")),
      readNullableString(readLicenseValue(record, "last_validated_at", "lastValidatedAt")),
      readString(readLicenseValue(record, "created_at", "createdAt"), now),
      readString(readLicenseValue(record, "updated_at", "updatedAt"), now),
    ],
  );
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

function errorMessage(error: unknown) {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Erreur inconnue";
}

async function importLocalStorageSnapshotToSqlite() {
  const existingStatus = await readMigrationStatus();

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
    });
    return;
  }

  let backup: SqliteDatabaseBackupInfo | null = null;
  const counts = getMigrationCounts(snapshot);

  try {
    backup = await backupDatabase();
    await upsertClients(snapshot.clients);
    await upsertPayments(snapshot.payments);

    if (snapshot.settings) {
      await upsertSettings(snapshot.settings);
    }

    await upsertLogs(snapshot.logs);
    await upsertNotifications(snapshot.notifications);
    await upsertLocalUsers(snapshot.localUsers);
    await upsertLicenseState(snapshot.licenseState);

    if (snapshot.smtpPassword) {
      await writeAppStateValue("smtp_password", snapshot.smtpPassword);
    }

    if (snapshot.lastSync) {
      await writeLastSync(snapshot.lastSync);
    }

    await writeMigrationStatus({
      status: "success",
      migratedAt: new Date().toISOString(),
      backupPath: backup.path,
      counts,
    });
  } catch (error) {
    await writeMigrationStatus({
      status: "failed",
      migratedAt: new Date().toISOString(),
      backupPath: backup?.path ?? null,
      counts,
      error: errorMessage(error),
    });
    throw error;
  }
}

export async function resetSqliteDevelopmentData() {
  await initializeSqliteCache();

  const db = await getDb();
  const settings = normalizeAdminSettings(cache.settings);

  await db.execute("DELETE FROM notification_queue");
  await db.execute("DELETE FROM activity_logs");
  await db.execute("DELETE FROM payments");
  await db.execute("DELETE FROM clients");
  await db.execute("DELETE FROM local_users WHERE role = 'employe'");
  await db.execute("DELETE FROM app_state WHERE key = 'last_sync'");
  await db.execute(
    `
      UPDATE admin_settings
      SET pending_sync = 0,
          sync_status = ?
      WHERE id = 'settings_default'
    `,
    [resetSettingsSyncStatus(settings)],
  );

  await hydrateCacheFromSqlite();
  emitCacheChange();
}

async function getTableCount(tableName: string) {
  const db = await getDb();
  const rows = await db.query<TableCountRow>(`SELECT COUNT(*) AS count FROM ${tableName}`);
  return readNumber(rows[0]?.count, 0);
}

export async function getSqliteStorageDiagnostics(): Promise<StorageDiagnostics> {
  await initializeSqliteCache();

  const tableNames = [
    "clients",
    "payments",
    "admin_settings",
    "activity_logs",
    "notification_queue",
    "local_users",
    "license_state",
    "app_state",
  ];
  const counts = await Promise.all(tableNames.map((tableName) => getTableCount(tableName)));
  const tableCounts = Object.fromEntries(
    tableNames.map((tableName, index) => [tableName, counts[index]]),
  );
  const localStorageBusinessDataKeys = getLegacyLocalStorageDataKeys();

  return {
    storageDriver: "sqlite",
    tableCounts,
    localStorageBusinessDataDetected: localStorageBusinessDataKeys.length > 0,
    localStorageBusinessDataKeys,
    migrationStatus: await readMigrationStatus(),
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

export function createSqliteCachedSyncService(syncDelegate: SyncRepository): SyncRepository {
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
      throw new Error(SQLITE_BACKEND_SYNC_UNAVAILABLE_MESSAGE);
    },
  };
}
