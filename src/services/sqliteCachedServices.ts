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
  getDb,
  initializeSqliteDatabase,
  resetSqliteInitialization,
  type SqliteRow,
} from "@/infrastructure/local/sqlite/sqliteClient";
import {
  clearLocalStorageKeys,
  emitChange,
  isBrowser,
  KEYS,
  SYNC_BRIDGE_KEYS,
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

const SQLITE_SYNC_BRIDGE_KEYS = [...SYNC_BRIDGE_KEYS, KEYS.syncBridgeActive] as const;

interface ClientRow extends SqliteRow {
  id: unknown;
  nom_complet: unknown;
  telephone: unknown;
  adresse: unknown;
  email: unknown;
  cin: unknown;
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
  value: unknown;
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
    await hydrateCacheFromSqlite();
    clearSqliteSyncBridge();
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

function clearSqliteSyncBridge() {
  clearLocalStorageKeys(SQLITE_SYNC_BRIDGE_KEYS);
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

function hasActiveSyncBridge() {
  return isBrowser() && localStorage.getItem(KEYS.syncBridgeActive) === "1";
}

function writeSyncBridgeSnapshot() {
  if (!isBrowser()) {
    return;
  }

  localStorage.setItem(KEYS.syncBridgeActive, "1");
  localStorage.setItem(KEYS.clients, JSON.stringify(cache.clients));
  localStorage.setItem(KEYS.payments, JSON.stringify(cache.payments));
  localStorage.setItem(KEYS.settings, JSON.stringify(cache.settings));
  localStorage.setItem(KEYS.logs, JSON.stringify(cache.logs));
  localStorage.setItem(KEYS.notifications, JSON.stringify(cache.notifications));

  if (cache.lastSync) {
    localStorage.setItem(KEYS.lastSync, JSON.stringify(cache.lastSync));
  } else {
    localStorage.removeItem(KEYS.lastSync);
  }
}

function readLocalStorageSnapshot() {
  if (!hasActiveSyncBridge()) {
    return null;
  }

  return {
    clients: localStorageJson<Client[]>(KEYS.clients, []),
    payments: localStorageJson<Payment[]>(KEYS.payments, []),
    settings: normalizeAdminSettings(localStorageJson<AdminSettings>(KEYS.settings, emptySettings())),
    logs: localStorageJson<ActivityLog[]>(KEYS.logs, []),
    notifications: localStorageJson<NotificationItem[]>(KEYS.notifications, []),
    lastSync: localStorageLastSync(),
  };
}

async function replaceClients(clients: Client[]) {
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
          created_at,
          updated_at,
          created_by,
          updated_by,
          deleted_at,
          remote_updated_at,
          pending_sync,
          sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        client.id,
        client.nom_complet,
        client.telephone,
        client.adresse,
        client.email,
        client.cin,
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

async function replacePayments(payments: Payment[]) {
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

async function replaceSettings(settings: AdminSettings) {
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

async function replaceLogs(logs: ActivityLog[]) {
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

async function replaceNotifications(notifications: NotificationItem[]) {
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

async function clearSnapshotTables() {
  const db = await getDb();
  await db.execute("DELETE FROM payments");
  await db.execute("DELETE FROM notification_queue");
  await db.execute("DELETE FROM activity_logs");
  await db.execute("DELETE FROM admin_settings");
  await db.execute("DELETE FROM clients");
}

async function persistLocalStorageSnapshotToSqlite() {
  const snapshot = readLocalStorageSnapshot();

  if (!snapshot) {
    return false;
  }

  await clearSnapshotTables();
  await replaceClients(snapshot.clients);
  await replacePayments(snapshot.payments);
  await replaceSettings(snapshot.settings);
  await replaceLogs(snapshot.logs);
  await replaceNotifications(snapshot.notifications);
  await writeLastSync(snapshot.lastSync);
  await hydrateCacheFromSqlite();
  return true;
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
  clearSqliteSyncBridge();
  emitCacheChange();
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
      writeSyncBridgeSnapshot();

      let result: SyncResult | null = null;
      let syncError: unknown = null;

      try {
        result = await Promise.resolve(syncDelegate.syncPendingData());
      } catch (error) {
        syncError = error;
      }

      try {
        const appliedBridgeSnapshot = await persistLocalStorageSnapshotToSqlite();

        if (!appliedBridgeSnapshot) {
          await hydrateCacheFromSqlite();
        }
      } finally {
        clearSqliteSyncBridge();
        emitCacheChange();
      }

      if (syncError) {
        throw syncError;
      }

      return result ?? { ok: false, synced: 0 };
    },
  };
}
