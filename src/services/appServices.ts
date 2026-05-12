/**
 * Central service registry — the single entry point used by the UI.
 *
 * Authentication can now switch between the local demo adapter and the real
 * backend via `VITE_USE_LOCAL_AUTH`.
 *
 * All CRUD services remain local/offline-first.
 * Manual sync switches to the backend sync API when backend auth is enabled.
 */
import {
  createLocalEmployeeAccount,
  initializeOfflineAuthStorage,
  listLocalEmployeeAccounts,
  resetLocalEmployeeAccounts,
  updateLocalEmployeeAccount as updateStoredLocalEmployeeAccount,
  upsertLocalEmployeeAccount,
} from "@/infrastructure/auth/offlineAuthStorage";
import { authLocalRepository } from "@/infrastructure/local/authLocalRepository";
import { clientLocalRepository } from "@/infrastructure/local/clientLocalRepository";
import { paymentLocalRepository } from "@/infrastructure/local/paymentLocalRepository";
import { adminSettingsLocalRepository } from "@/infrastructure/local/adminSettingsLocalRepository";
import { activityLogLocalRepository } from "@/infrastructure/local/activityLogLocalRepository";
import { notificationLocalRepository } from "@/infrastructure/local/notificationLocalRepository";
import {
  BACKEND_SYNC_DISABLED_MESSAGE,
  isBackendSyncEnabled,
  normalizeSmtpPasswordForProvider,
  normalizeSmtpPasswordValue,
  normalizeAdminSettings,
} from "@/infrastructure/local/adminSettingsState";
import {
  changeDatabaseLocation as changeSqliteDatabaseLocation,
  chooseDatabaseFolder as chooseSqliteDatabaseFolder,
  getDatabaseLocation as getSqliteDatabaseLocation,
  isTauriRuntime,
  openDatabaseLocation as openSqliteDatabaseLocation,
} from "@/infrastructure/local/sqlite/sqliteClient";
import { sendDesktopEmail } from "@/infrastructure/local/sqlite/desktopEmailClient";
import { getStoredSmtpPassword } from "@/infrastructure/local/smtpPasswordStorage";
import { apiFetch, ApiError } from "@/infrastructure/remote/apiClient";
import { authRemoteRepository } from "@/infrastructure/remote/authRemoteRepository";
import { userRemoteService } from "@/infrastructure/remote/userRemoteService";
import { syncService as defaultSyncService } from "@/infrastructure/sync/syncService";
import {
  clearLocalStorageKeys,
  KEYS,
  seedIfNeeded as seedLocalStorageIfNeeded,
  write,
} from "@/infrastructure/local/localStorageDatabase";
import {
  buildPaymentNotificationStatusMap,
  getPaymentNotificationStatuses as resolvePaymentNotificationStatuses,
} from "@/services/paymentNotificationService";
import { isConnectionOnline, setConnectionTestOverride } from "./connectionService";
import {
  createSqliteCachedSyncService,
  initializeSqliteCache,
  reloadSqliteCache,
  resetSqliteDevelopmentData,
  sqliteCachedActivityLogService,
  sqliteCachedAdminSettingsService,
  sqliteCachedClientService,
  sqliteCachedNotificationService,
  sqliteCachedPaymentService,
} from "./sqliteCachedServices";

const useLocalAuth = import.meta.env.VITE_USE_LOCAL_AUTH === "true";
export type StorageDriver = "localStorage" | "sqlite";
export const storageDriver: StorageDriver =
  import.meta.env.VITE_STORAGE_DRIVER === "sqlite" ? "sqlite" : "localStorage";
export const useSQLiteStorage = storageDriver === "sqlite" && isTauriRuntime();

export const authService = useLocalAuth ? authLocalRepository : authRemoteRepository;
const sqliteSyncService = createSqliteCachedSyncService(defaultSyncService);

// Browser/dev mode stays on localStorage by default.
// Desktop mode enables SQLite only when VITE_STORAGE_DRIVER=sqlite and the app runs inside Tauri.
// The SQLite path uses an in-memory cache because the current React UI still reads data synchronously.
export const clientService = useSQLiteStorage ? sqliteCachedClientService : clientLocalRepository;
export const paymentService = useSQLiteStorage ? sqliteCachedPaymentService : paymentLocalRepository;
export const adminSettingsService = useSQLiteStorage
  ? sqliteCachedAdminSettingsService
  : adminSettingsLocalRepository;
export const activityLogService = useSQLiteStorage
  ? sqliteCachedActivityLogService
  : activityLogLocalRepository;
export const notificationService = useSQLiteStorage
  ? sqliteCachedNotificationService
  : notificationLocalRepository;
const baseSyncService = useSQLiteStorage ? sqliteSyncService : defaultSyncService;

export { formatTND, formatDateFR, formatDateTimeFR } from "@/lib/format";

export function seedIfNeeded() {
  if (useSQLiteStorage) {
    return;
  }

  seedLocalStorageIfNeeded();
}

let storageDriverInitializationPromise: Promise<true | null> | null = null;

export async function initializeStorageDriver() {
  storageDriverInitializationPromise ??= (async () => {
    await initializeOfflineAuthStorage();

    if (!useSQLiteStorage) {
      seedLocalStorageIfNeeded();
    }

    if (useSQLiteStorage) {
      await initializeSqliteCache();
    }

    await cleanupSentNotificationsByRetention(true);
    return useSQLiteStorage ? true : null;
  })().catch((error) => {
    storageDriverInitializationPromise = null;
    throw error;
  });

  return storageDriverInitializationPromise;
}

if (typeof window !== "undefined") {
  void initializeStorageDriver().catch((error) => {
    console.error("Storage initialization failed.", error);
  });
}

import type {
  ActivityLog,
  AdminSettings,
  Client,
  ClientCreateInput,
  ClientUpdateInput,
  Payment,
  PaymentCreateInput,
  AdminSettingsUpdateInput,
  EmployeeAccount,
  EmployeeAccountCreateInput,
  EmployeeAccountListResult,
  EmployeeAccountUpdateInput,
  NotificationItem,
  User,
  SmtpProviderType,
} from "@/domain/types";
import type { SyncRepository } from "@/domain/repositories";

const SMTP_TEST_SUBJECT = "Test SMTP - ClientAdvance";
const SMTP_TEST_BODY = `Bonjour,

Ceci est un email de test envoyé depuis ClientAdvance.

Si vous recevez ce message, la configuration SMTP fonctionne correctement.`;
const MISSING_SMTP_TEST_MESSAGE =
  "Paramètres SMTP manquants. Veuillez les configurer avant de tester l'envoi.";
const MISSING_SMTP_PASSWORD_MESSAGE = "Mot de passe SMTP manquant.";
const GMAIL_SMTP_HOST = "smtp.gmail.com";
const GMAIL_SMTP_PORT = 587;
const GMAIL_APP_PASSWORD_HINT =
  "Pour Gmail, utilisez un mot de passe d'application, pas le mot de passe normal du compte Gmail.";

export const getCurrentUser = () => authService.getCurrentUser();
export const login = (identifier: string, password: string) =>
  authService.login(identifier, password);
export const logout = () => authService.logout();

type DailyScopeDateField<T> =
  | keyof T
  | ((item: T) => string | Date | null | undefined);

export function isAdmin(user: Pick<User, "role"> | null | undefined) {
  return user?.role === "admin";
}

export function isEmployee(user: Pick<User, "role"> | null | undefined) {
  return user?.role === "employe";
}

function parseLocalDateValue(value: string | Date | null | undefined) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);

  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return date;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isSameLocalDay(
  value: string | Date | null | undefined,
  referenceDate = new Date(),
) {
  const date = parseLocalDateValue(value);

  if (!date) {
    return false;
  }

  return (
    date.getFullYear() === referenceDate.getFullYear() &&
    date.getMonth() === referenceDate.getMonth() &&
    date.getDate() === referenceDate.getDate()
  );
}

function resolveScopedDate<T>(item: T, dateField: DailyScopeDateField<T>) {
  if (typeof dateField === "function") {
    return dateField(item);
  }

  const value = item[dateField];
  return value instanceof Date || typeof value === "string" ? value : null;
}

// TODO: If client/payment listing moves to direct backend endpoints, enforce the
// same employee day scope server-side in addition to this local/UI filter.
export function filterForCurrentUserDailyScope<T>(
  items: T[],
  user: Pick<User, "role"> | null | undefined,
  dateField: DailyScopeDateField<T>,
  referenceDate = new Date(),
) {
  if (!isEmployee(user)) {
    return items;
  }

  return items.filter((item) =>
    isSameLocalDay(resolveScopedDate(item, dateField), referenceDate),
  );
}

function getUnscopedClients() {
  return clientService.getAll() as Client[];
}

function paymentBusinessDate(payment: Payment) {
  return parseLocalDateValue(payment.date_paiement)
    ? payment.date_paiement
    : payment.created_at || null;
}

function getUnscopedPayments() {
  return paymentService.getAll() as Payment[];
}

export const getAllClients = () => getUnscopedClients();
export const getAllPayments = () => getUnscopedPayments();
export const getClients = () =>
  filterForCurrentUserDailyScope(
    getUnscopedClients(),
    getCurrentUser(),
    "created_at",
  );
export const getClient = (id: string) =>
  getClients().find((client) => client.id === id) ?? null;
export const getClientReferenceById = (id: string) =>
  getUnscopedClients().find((client) => client.id === id) ?? null;
export const createClient = (input: ClientCreateInput) => clientService.create(input);
export const updateClient = (id: string, patch: ClientUpdateInput) => {
  void clientService.update(id, patch);
};
export const deleteClient = (id: string) => {
  void clientService.delete(id);
};

export const getPayments = () =>
  filterForCurrentUserDailyScope(
    getUnscopedPayments(),
    getCurrentUser(),
    paymentBusinessDate,
  );
export const getPaymentsByClient = (id: string) =>
  getPayments().filter((payment) => payment.client_id === id);
export const createPayment = (input: PaymentCreateInput) => paymentService.create(input);
export type LocalPaymentSyncDisplayStatus = "saved-local" | "failed-local";
export type ServerPaymentSyncDisplayStatus =
  | "synced"
  | "pending"
  | "failed"
  | "not-applicable";

export function getLocalSyncStatus(
  payment: Pick<Payment, "id"> | null | undefined,
): LocalPaymentSyncDisplayStatus {
  return typeof payment?.id === "string" && payment.id.trim().length > 0
    ? "saved-local"
    : "failed-local";
}

export function getServerSyncStatus(
  payment: Pick<Payment, "pending_sync" | "sync_status">,
  settings: Pick<AdminSettings, "server_mode">,
): ServerPaymentSyncDisplayStatus {
  if (settings.server_mode === "without-server") {
    return "not-applicable";
  }

  if (payment.sync_status === "failed") {
    return "failed";
  }

  if (
    payment.pending_sync === true ||
    payment.sync_status === "pending" ||
    payment.sync_status === "local"
  ) {
    return "pending";
  }

  if (payment.sync_status === "synced" || payment.pending_sync === false) {
    return "synced";
  }

  return "pending";
}
export const getPaymentNotificationStatusMap = () =>
  buildPaymentNotificationStatusMap(getNotifications());
export const getPaymentNotificationStatuses = (
  paymentId: string,
  notificationStatusMap = getPaymentNotificationStatusMap(),
) => resolvePaymentNotificationStatuses(paymentId, notificationStatusMap, getAdminSettings());

export const getAdminSettings = () => adminSettingsService.get() as AdminSettings;
export const getServerMode = () => getAdminSettings().server_mode;
export const isBackendSyncMode = () => isBackendSyncEnabled(getAdminSettings());
export const updateAdminSettings = (patch: AdminSettingsUpdateInput) =>
  adminSettingsService.update(patch);

interface SmtpTestInput {
  recipientEmail: string;
  smtpProviderType: SmtpProviderType;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword?: string;
  smtpSecure: boolean;
  smtpFromEmail: string;
  smtpFromName: string;
}

function decorateSmtpTestError(message: string, smtpProviderType: SmtpProviderType) {
  if (
    smtpProviderType === "gmail" &&
    /(auth|authentication|credential|password|username|535)/i.test(message) &&
    !message.includes(GMAIL_APP_PASSWORD_HINT)
  ) {
    return `${message} ${GMAIL_APP_PASSWORD_HINT}`;
  }

  return message;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Erreur inconnue";
}

export async function testAdminSmtpEmail(input: SmtpTestInput) {
  if (!isAdmin(getCurrentUser())) {
    throw new Error("Accès refusé. Cette section est réservée à l'administrateur.");
  }

  const isGmailProvider = input.smtpProviderType === "gmail";
  const recipientEmail = input.recipientEmail.trim();
  const smtpHost = (isGmailProvider ? GMAIL_SMTP_HOST : input.smtpHost).trim();
  const smtpPort = isGmailProvider ? GMAIL_SMTP_PORT : input.smtpPort;
  const smtpUsername = input.smtpUsername.trim();
  const smtpFromEmail = (
    isGmailProvider ? input.smtpFromEmail.trim() || smtpUsername : input.smtpFromEmail
  ).trim();
  const typedSmtpPassword = normalizeSmtpPasswordValue(input.smtpPassword);
  const storedSmtpPassword = normalizeSmtpPasswordValue(await getStoredSmtpPassword());
  const smtpPassword = normalizeSmtpPasswordForProvider(
    input.smtpProviderType,
    typedSmtpPassword || storedSmtpPassword,
  );

  if (
    recipientEmail.length === 0 ||
    smtpHost.length === 0 ||
    !Number.isFinite(smtpPort) ||
    smtpPort <= 0 ||
    smtpUsername.length === 0 ||
    smtpFromEmail.length === 0
  ) {
    throw new Error(MISSING_SMTP_TEST_MESSAGE);
  }

  if (smtpPassword.length === 0) {
    throw new Error(MISSING_SMTP_PASSWORD_MESSAGE);
  }

  try {
    await sendDesktopEmail({
      host: smtpHost,
      port: smtpPort,
      username: smtpUsername,
      password: smtpPassword,
      secure: isGmailProvider ? false : input.smtpSecure,
      fromEmail: smtpFromEmail,
      fromName: input.smtpFromName.trim(),
      to: recipientEmail,
      subject: SMTP_TEST_SUBJECT,
      body: SMTP_TEST_BODY,
    });
  } catch (error) {
    throw new Error(
      decorateSmtpTestError(getErrorMessage(error), input.smtpProviderType),
    );
  }
}

export async function getLocalDatabaseLocation() {
  if (!isAdmin(getCurrentUser())) {
    throw new Error("Accès refusé. Cette section est réservée à l'administrateur.");
  }

  if (!isTauriRuntime()) {
    throw new Error("Cette option est disponible uniquement dans l'application desktop.");
  }

  return getSqliteDatabaseLocation();
}

export async function openLocalDatabaseLocation() {
  if (!isAdmin(getCurrentUser())) {
    throw new Error("Accès refusé. Cette section est réservée à l'administrateur.");
  }

  if (!isTauriRuntime()) {
    throw new Error("Cette option est disponible uniquement dans l'application desktop.");
  }

  await openSqliteDatabaseLocation();
}

export async function chooseLocalDatabaseFolder() {
  if (!isAdmin(getCurrentUser())) {
    throw new Error("Accès refusé. Cette section est réservée à l'administrateur.");
  }

  if (!isTauriRuntime()) {
    throw new Error("Cette option est disponible uniquement dans l'application desktop.");
  }

  return chooseSqliteDatabaseFolder();
}

export async function changeLocalDatabaseLocation(
  folderPath: string,
  replaceExisting = false,
) {
  if (!isAdmin(getCurrentUser())) {
    throw new Error("Accès refusé. Cette section est réservée à l'administrateur.");
  }

  if (!isTauriRuntime()) {
    throw new Error("Cette option est disponible uniquement dans l'application desktop.");
  }

  const result = await changeSqliteDatabaseLocation(folderPath, replaceExisting);

  if (!result.requiresConfirmation && useSQLiteStorage) {
    try {
      await reloadSqliteCache();
    } catch (error) {
      console.error("SQLite cache reload after database move failed.", error);
    }
  }

  return result;
}

function resetSettingsSyncStatus(settings: AdminSettings) {
  return settings.server_mode === "without-server" ? "local" : "synced";
}

function resetLocalStorageBusinessData() {
  const currentSettings = getAdminSettings();
  const settings = normalizeAdminSettings({
    ...currentSettings,
    pending_sync: false,
    sync_status: resetSettingsSyncStatus(currentSettings),
  });

  write(KEYS.clients, []);
  write(KEYS.payments, []);
  write(KEYS.logs, []);
  write(KEYS.notifications, []);
  write(KEYS.settings, settings);
  clearLocalStorageKeys([KEYS.lastSync, KEYS.syncBridgeActive], { emit: true });
}

async function resetRemoteDevelopmentData() {
  try {
    await apiFetch("/admin-settings/reset-test-data", {
      method: "POST",
    });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 0) {
        throw new Error(
          "Impossible de réinitialiser les données serveur. Le backend est indisponible.",
        );
      }

      if (error.status === 401 || error.status === 403) {
        throw new Error(
          "Impossible de réinitialiser les données serveur. Vérifiez votre session administrateur.",
        );
      }
    }

    throw error instanceof Error
      ? error
      : new Error("Impossible de réinitialiser les données serveur.");
  }
}

export async function resetDevelopmentTestData() {
  await initializeStorageDriver();

  if (!isAdmin(getCurrentUser())) {
    throw new Error("Accès refusé. Cette section est réservée à l'administrateur.");
  }

  if (getServerMode() === "with-server") {
    await resetRemoteDevelopmentData();
  }

  await resetLocalEmployeeAccounts();

  if (useSQLiteStorage) {
    await resetSqliteDevelopmentData();
    return;
  }

  resetLocalStorageBusinessData();
}

export const syncService: SyncRepository = {
  getPendingCount() {
    return isBackendSyncMode() ? baseSyncService.getPendingCount() : 0;
  },
  syncPendingData() {
    if (!isBackendSyncMode()) {
      throw new Error(BACKEND_SYNC_DISABLED_MESSAGE);
    }

    return baseSyncService.syncPendingData();
  },
  getLastSync() {
    return baseSyncService.getLastSync();
  },
  setOnlineMode(value) {
    baseSyncService.setOnlineMode(value);
  },
  isOnlineMode() {
    return baseSyncService.isOnlineMode();
  },
};

export const getActivityLogs = () => activityLogService.getAll() as ActivityLog[];
export const getNotifications = () => notificationService.getAll() as NotificationItem[];

function getNotificationRetentionDays() {
  return Math.max(1, Math.trunc(getAdminSettings().notification_retention_days || 30));
}

function notificationRetentionCutoffIso(retentionDays: number) {
  return new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
}

async function cleanupSentNotificationsByRetention(skipInitialization = false) {
  if (!skipInitialization) {
    await initializeStorageDriver();
  }

  return Promise.resolve(
    notificationService.clearSent({
      sentBefore: notificationRetentionCutoffIso(getNotificationRetentionDays()),
      syncedOnly: true,
    }),
  );
}

export async function cleanupOldSentNotifications() {
  return cleanupSentNotificationsByRetention();
}

export async function clearSentNotifications() {
  await initializeStorageDriver();

  if (!isAdmin(getCurrentUser())) {
    throw new Error("Accès refusé. Cette section est réservée à l'administrateur.");
  }

  return Promise.resolve(notificationService.clearSent());
}

function usesServerModeForEmployees() {
  return getServerMode() === "with-server";
}

export const getEmployeeAccounts = async (): Promise<EmployeeAccountListResult> => {
  if (!usesServerModeForEmployees()) {
    return {
      employees: await listLocalEmployeeAccounts(),
      source: "local",
      serverUnavailable: false,
    };
  }

  try {
    const employees = await userRemoteService.list();
    await Promise.all(
      employees.map((employee) =>
        upsertLocalEmployeeAccount(employee, {
          sync_status: "synced",
          pending_sync: false,
        }),
      ),
    );

    return {
      employees,
      source: "backend",
      serverUnavailable: false,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 0) {
      return {
        employees: await listLocalEmployeeAccounts(),
        source: "local",
        serverUnavailable: true,
      };
    }

    throw error;
  }
};

export const createEmployeeAccount = async (
  input: EmployeeAccountCreateInput,
): Promise<EmployeeAccount> => {
  if (!usesServerModeForEmployees()) {
    return createLocalEmployeeAccount(input, {
      offline_enabled: true,
      sync_status: "local",
      pending_sync: false,
    });
  }

  try {
    const employee = await userRemoteService.create(input);

    await upsertLocalEmployeeAccount(employee, {
      password: input.password,
      offline_enabled: true,
      sync_status: "synced",
      pending_sync: false,
    });

    return employee;
  } catch (error) {
    if (error instanceof ApiError && error.status === 0) {
      throw new Error("Impossible de créer l’employé sur le serveur.");
    }

    throw error;
  }
};

export const updateEmployeeAccount = async (
  id: string,
  patch: EmployeeAccountUpdateInput,
): Promise<EmployeeAccount> => {
  if (!usesServerModeForEmployees()) {
    return updateStoredLocalEmployeeAccount(id, patch, {
      offline_enabled: patch.password !== undefined ? true : undefined,
      sync_status: "local",
      pending_sync: false,
    });
  }

  try {
    const employee = await userRemoteService.update(id, patch);
    await upsertLocalEmployeeAccount(employee, {
      password: patch.password,
      offline_enabled: patch.password !== undefined ? true : undefined,
      sync_status: "synced",
      pending_sync: false,
    });

    return employee;
  } catch (error) {
    if (error instanceof ApiError && error.status === 0) {
      throw new Error("Impossible de mettre à jour l’employé sur le serveur.");
    }

    throw error;
  }
};

export const isOnline = () => isConnectionOnline();
export const setOnline = (v: boolean) => setConnectionTestOverride(v);
export const getLastSync = () => syncService.getLastSync();
export const getPendingCount = () => syncService.getPendingCount();
export const syncPendingData = () => syncService.syncPendingData();
