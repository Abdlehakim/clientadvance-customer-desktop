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
  authenticateOfflineCredential,
  createLocalEmployeeAccount,
  deleteLocalEmployeeAccount,
  getPendingLocalEmployeeAccountSyncCount,
  initializeOfflineAuthStorage,
  listPendingLocalEmployeeAccountSyncRecords,
  listLocalEmployeeAccounts,
  markLocalEmployeeAccountDeleted,
  markLocalEmployeeAccountSynced,
  resetLocalEmployeeAccounts,
  updateLocalEmployeeAccount as updateStoredLocalEmployeeAccount,
  upsertLocalEmployeeAccount,
} from "@/infrastructure/auth/offlineAuthStorage";
import { getCurrentCompanyScope } from "@/infrastructure/auth/currentCompanyScope";
import {
  BACKEND_SYNC_DISABLED_MESSAGE,
  isBackendSyncEnabled,
  normalizeSmtpPasswordForProvider,
  normalizeSmtpPasswordValue,
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
import { syncRemoteService } from "@/infrastructure/remote/syncRemoteService";
import { getFriendlySmtpErrorMessage } from "@/lib/smtpErrorMessage";
import {
  authRemoteRepository,
  isRemoteAuthOfflineSession,
  persistRemoteOfflineUserSession,
} from "@/infrastructure/remote/authRemoteRepository";
import { userRemoteService } from "@/infrastructure/remote/userRemoteService";
import {
  buildPaymentNotificationStatusMap,
  getPaymentNotificationStatuses as resolvePaymentNotificationStatuses,
} from "@/services/paymentNotificationService";
import { isConnectionOnline, setConnectionTestOverride } from "./connectionService";
import {
  cleanupLegacyLocalStorageData as cleanupSqliteLegacyLocalStorageData,
  createSqliteCachedSyncService,
  getSqliteStorageDiagnostics,
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
export type StorageDriver = "sqlite";
export const storageDriver: StorageDriver = "sqlite";
const configuredStorageDriver = import.meta.env.VITE_STORAGE_DRIVER;
export const useSQLiteStorage = configuredStorageDriver === "sqlite" && isTauriRuntime();
export const SQLITE_STORAGE_REQUIRED_MESSAGE =
  "Stockage SQLite desktop requis. Lancez l'application Tauri avec VITE_STORAGE_DRIVER=sqlite.";

export const authService = authRemoteRepository;
const sqliteSyncService = createSqliteCachedSyncService({
  fullSync: syncRemoteService.fullSync,
  setOnlineMode: setConnectionTestOverride,
  isOnlineMode: isConnectionOnline,
});

// SQLite is the only durable storage path. Browser/dev runs must fail loudly
// instead of falling back to localStorage business data.
export const clientService = sqliteCachedClientService;
export const paymentService = sqliteCachedPaymentService;
export const adminSettingsService = sqliteCachedAdminSettingsService;
export const activityLogService = sqliteCachedActivityLogService;
export const notificationService = sqliteCachedNotificationService;
const baseSyncService = sqliteSyncService;

export { formatTND, formatDateFR, formatDateTimeFR } from "@/lib/format";

export function seedIfNeeded() {
  // SQLite is initialized asynchronously by initializeStorageDriver().
}

export function assertSqliteStorageAvailable() {
  if (configuredStorageDriver !== "sqlite") {
    throw new Error(SQLITE_STORAGE_REQUIRED_MESSAGE);
  }

  if (!isTauriRuntime()) {
    throw new Error(SQLITE_STORAGE_REQUIRED_MESSAGE);
  }
}

let storageDriverInitializationPromise: Promise<true | null> | null = null;

export async function initializeStorageDriver() {
  storageDriverInitializationPromise ??= (async () => {
    assertSqliteStorageAvailable();
    await initializeOfflineAuthStorage();
    await initializeSqliteCache();

    await cleanupSentNotificationsByRetention(true);
    return true;
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
  EmployeePasswordChangeInput,
  EmployeeAccountUpdateInput,
  NotificationItem,
  User,
  SmtpProviderType,
} from "@/domain/types";
import type { SyncRepository, SyncResult } from "@/domain/repositories";

const SMTP_TEST_SUBJECT = "Test SMTP - ClientAdvans";
const SMTP_TEST_BODY = `Bonjour,

Ceci est un email de test envoyé depuis ClientAdvans.

Si vous recevez ce message, la configuration SMTP fonctionne correctement.`;
const MISSING_SMTP_TEST_MESSAGE =
  "Paramètres SMTP manquants. Veuillez les configurer avant de tester l'envoi.";
const MISSING_SMTP_PASSWORD_MESSAGE = "Mot de passe SMTP manquant.";
const GMAIL_SMTP_HOST = "smtp.gmail.com";
const GMAIL_SMTP_PORT = 587;

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
export const getPaymentSelectableClients = () => getUnscopedClients();
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
export const updateClient = (
  id: string,
  patch: ClientUpdateInput,
) => clientService.update(id, patch);
export const deleteClient = (id: string) =>
  clientService.delete(id);

export const getPayments = () =>
  filterForCurrentUserDailyScope(
    getUnscopedPayments(),
    getCurrentUser(),
    paymentBusinessDate,
  );
export const getPaymentsByClient = (id: string) =>
  getPayments().filter((payment) => payment.client_id === id);
export const createPayment = (input: PaymentCreateInput) => paymentService.create(input);
export async function deletePayment(id: string) {
  if (!isAdmin(getCurrentUser())) {
    throw new Error("AccÃ¨s refusÃ©. Cette action est rÃ©servÃ©e Ã  l'administrateur.");
  }

  if (!paymentService.delete) {
    throw new Error("Suppression du paiement indisponible.");
  }

  await paymentService.delete(id);
}
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
    console.error("SMTP test email failed.", error);

    throw new Error(
      getFriendlySmtpErrorMessage(error, input.smtpProviderType),
    );
  }
}

export async function getStorageDiagnostics() {
  if (!isAdmin(getCurrentUser())) {
    throw new Error("AccÃ¨s refusÃ©. Cette section est rÃ©servÃ©e Ã  l'administrateur.");
  }

  assertSqliteStorageAvailable();
  return getSqliteStorageDiagnostics();
}

export async function cleanupLegacyLocalStorageData() {
  if (!isAdmin(getCurrentUser())) {
    throw new Error("AccÃ¨s refusÃ©. Cette section est rÃ©servÃ©e Ã  l'administrateur.");
  }

  assertSqliteStorageAvailable();
  const diagnostics = await getSqliteStorageDiagnostics();

  if (
    diagnostics.storageDriver !== "sqlite" ||
    diagnostics.migrationStatus?.status !== "success" ||
    !diagnostics.tableCounts
  ) {
    throw new Error(
      "Nettoyage indisponible. La migration SQLite doit \u00eatre termin\u00e9e avec succ\u00e8s.",
    );
  }

  return cleanupSqliteLegacyLocalStorageData();
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

  return openSqliteDatabaseLocation();
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

  if (!result.requiresConfirmation) {
    try {
      await reloadSqliteCache();
    } catch (error) {
      console.error("SQLite cache reload after database move failed.", error);
    }
  }

  return result;
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

  await resetSqliteDevelopmentData();
}

export const syncService: SyncRepository = {
  getPendingCount() {
    if (!isBackendSyncMode()) {
      return 0;
    }

    const pendingEmployeeCount = usesServerModeForEmployees()
      ? getPendingLocalEmployeeAccountSyncCount()
      : 0;

    return baseSyncService.getPendingCount() + pendingEmployeeCount;
  },
  async syncPendingData(): Promise<SyncResult> {
    if (!isBackendSyncMode()) {
      throw new Error(BACKEND_SYNC_DISABLED_MESSAGE);
    }

    const result = await Promise.resolve(baseSyncService.syncPendingData());

    if (!result.ok) {
      return result;
    }

    const syncedEmployeeCount = usesServerModeForEmployees()
      ? await syncPendingEmployeeAccounts()
      : 0;

    return {
      ok: result.ok,
      synced: result.synced + syncedEmployeeCount,
    };
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

  if (!getCurrentCompanyScope()) {
    return 0;
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

export const MAX_EMPLOYEES = 4;
export const EMPLOYEE_LIMIT_REACHED_MESSAGE =
  "Limite atteinte : vous pouvez créer au maximum 4 E-user.";

export function getEmployeeCount(employees: Pick<EmployeeAccount, "role">[]) {
  return employees.filter((employee) => employee.role === "employe").length;
}

export function hasReachedEmployeeLimit(employees: Pick<EmployeeAccount, "role">[]) {
  return getEmployeeCount(employees) >= MAX_EMPLOYEES;
}

type EmployeeLimitSubject = Pick<EmployeeAccount, "id" | "email" | "role">;

function mergeEmployeeLimitSubjects(...employeeGroups: EmployeeLimitSubject[][]) {
  const merged: EmployeeLimitSubject[] = [];
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();

  for (const employee of employeeGroups.flat()) {
    const id = employee.id.trim();
    const email = employee.email.trim().toLowerCase();

    if ((id && seenIds.has(id)) || (email && seenEmails.has(email))) {
      continue;
    }

    merged.push(employee);

    if (id) {
      seenIds.add(id);
    }

    if (email) {
      seenEmails.add(email);
    }
  }

  return merged;
}

function assertCanCreateEmployee(employees: Pick<EmployeeAccount, "role">[]) {
  if (hasReachedEmployeeLimit(employees)) {
    throw new Error(EMPLOYEE_LIMIT_REACHED_MESSAGE);
  }
}

function isApiUnavailableError(error: unknown) {
  return error instanceof ApiError && error.status === 0;
}

async function createEmployeeAccountLocally(
  input: EmployeeAccountCreateInput,
  knownEmployees: EmployeeLimitSubject[] = [],
  options: { pendingSync?: boolean } = {},
) {
  assertCanCreateEmployee(
    mergeEmployeeLimitSubjects(knownEmployees, await listLocalEmployeeAccounts()),
  );

  return createLocalEmployeeAccount(input, {
    offline_enabled: true,
    sync_status: "local",
    pending_sync: options.pendingSync ?? false,
    sync_action: options.pendingSync ? "create" : "none",
  });
}

function mergeLocalEmployeeCacheFields(
  employees: EmployeeAccount[],
  localEmployees: EmployeeAccount[],
) {
  const localById = new Map(localEmployees.map((employee) => [employee.id, employee]));
  const localByEmail = new Map(
    localEmployees.map((employee) => [employee.email.trim().toLowerCase(), employee]),
  );

  return employees.map((employee) => {
    const localEmployee =
      localById.get(employee.id) ?? localByEmail.get(employee.email.trim().toLowerCase());
    const usePendingLocalData =
      localEmployee?.pending_sync === true && localEmployee.sync_action !== "delete";
    const mergedEmployee = {
      ...employee,
      displayPassword: localEmployee?.displayPassword || employee.displayPassword,
      phone: employee.phone || localEmployee?.phone || "",
      sync_status: localEmployee?.sync_status ?? employee.sync_status,
      pending_sync: localEmployee?.pending_sync ?? employee.pending_sync,
      sync_action: localEmployee?.sync_action ?? employee.sync_action,
      deleted_at: localEmployee?.deleted_at ?? employee.deleted_at,
    };

    if (!usePendingLocalData) {
      return mergedEmployee;
    }

    return {
      ...mergedEmployee,
      name: localEmployee.name,
      phone: localEmployee.phone || "",
      is_active: localEmployee.is_active,
      updated_at: localEmployee.updated_at,
      displayPassword: localEmployee?.displayPassword || employee.displayPassword,
    };
  });
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
    const pendingLocalEmployees = await listPendingLocalEmployeeAccountSyncRecords();
    const pendingLocalById = new Map(
      pendingLocalEmployees.map((employee) => [employee.id, employee]),
    );
    const pendingLocalByEmail = new Map(
      pendingLocalEmployees.map((employee) => [employee.email.trim().toLowerCase(), employee]),
    );

    await Promise.all(
      employees.map((employee) => {
        const pendingLocalEmployee =
          pendingLocalById.get(employee.id) ??
          pendingLocalByEmail.get(employee.email.trim().toLowerCase());

        if (pendingLocalEmployee) {
          return Promise.resolve();
        }

        return upsertLocalEmployeeAccount(employee, {
          sync_status: "synced",
          pending_sync: false,
          sync_action: "none",
        });
      }),
    );
    const localEmployees = await listLocalEmployeeAccounts();
    const pendingDeleteIds = new Set(
      pendingLocalEmployees
        .filter((employee) => employee.sync_action === "delete")
        .map((employee) => employee.id),
    );
    const pendingDeleteEmails = new Set(
      pendingLocalEmployees
        .filter((employee) => employee.sync_action === "delete")
        .map((employee) => employee.email.trim().toLowerCase()),
    );
    const visibleRemoteEmployees = employees.filter(
      (employee) =>
        !pendingDeleteIds.has(employee.id) &&
        !pendingDeleteEmails.has(employee.email.trim().toLowerCase()),
    );
    const visibleRemoteIds = new Set(visibleRemoteEmployees.map((employee) => employee.id));
    const visibleRemoteEmails = new Set(
      visibleRemoteEmployees.map((employee) => employee.email.trim().toLowerCase()),
    );
    const localOnlyEmployees = localEmployees.filter(
      (employee) =>
        employee.pending_sync === true &&
        !visibleRemoteIds.has(employee.id) &&
        !visibleRemoteEmails.has(employee.email.trim().toLowerCase()),
    );

    return {
      employees: [
        ...localOnlyEmployees,
        ...mergeLocalEmployeeCacheFields(visibleRemoteEmployees, localEmployees),
      ],
      source: "backend",
      serverUnavailable: false,
    };
  } catch (error) {
    if (isApiUnavailableError(error)) {
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
    return createEmployeeAccountLocally(input);
  }

  let remoteEmployees: EmployeeAccount[] = [];

  try {
    remoteEmployees = await userRemoteService.list();
    assertCanCreateEmployee(
      mergeEmployeeLimitSubjects(remoteEmployees, await listLocalEmployeeAccounts()),
    );

    const employee = await userRemoteService.create(input);

    const employeeForCache: EmployeeAccount = {
      ...employee,
      phone: employee.phone || input.phone || "",
    };
    const cachedEmployee = await upsertLocalEmployeeAccount(employeeForCache, {
      password: input.password,
      offline_enabled: true,
      sync_status: "synced",
      pending_sync: false,
      sync_action: "none",
    });

    return {
      ...employeeForCache,
      displayPassword: cachedEmployee.displayPassword,
      phone: cachedEmployee.phone || employeeForCache.phone,
      sync_status: cachedEmployee.sync_status,
      pending_sync: cachedEmployee.pending_sync,
    };
  } catch (error) {
    if (isApiUnavailableError(error)) {
      return createEmployeeAccountLocally(input, remoteEmployees, { pendingSync: true });
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
      sync_action: "none",
    });
  }

  try {
    const employee = await userRemoteService.update(id, patch);
    const employeeForCache: EmployeeAccount = {
      ...employee,
      phone: employee.phone || (patch.phone !== undefined ? patch.phone : undefined),
    };
    const cachedEmployee = await upsertLocalEmployeeAccount(employeeForCache, {
      password: patch.password,
      offline_enabled: patch.password !== undefined ? true : undefined,
      sync_status: "synced",
      pending_sync: false,
      sync_action: "none",
    });

    return {
      ...employeeForCache,
      displayPassword: cachedEmployee.displayPassword,
      phone: cachedEmployee.phone || employeeForCache.phone,
      sync_status: cachedEmployee.sync_status,
      pending_sync: cachedEmployee.pending_sync,
      sync_action: cachedEmployee.sync_action,
    };
  } catch (error) {
    if (isApiUnavailableError(error)) {
      return updateStoredLocalEmployeeAccount(id, patch, {
        offline_enabled: patch.password !== undefined ? true : undefined,
        sync_status: "local",
        pending_sync: true,
      });
    }

    throw error;
  }
};

function getEmployeeSyncPassword(employee: EmployeeAccount) {
  return employee.displayPassword && employee.displayPassword.length > 0
    ? employee.displayPassword
    : null;
}

function buildEmployeeSyncUpdatePatch(employee: EmployeeAccount): EmployeeAccountUpdateInput {
  const patch: EmployeeAccountUpdateInput = {
    name: employee.name,
    phone: employee.phone ?? "",
    is_active: employee.is_active,
  };
  const password = getEmployeeSyncPassword(employee);

  if (password) {
    patch.password = password;
  }

  return patch;
}

async function syncPendingEmployeeAccount(employee: EmployeeAccount) {
  switch (employee.sync_action) {
    case "create": {
      const password = getEmployeeSyncPassword(employee);

      if (!password) {
        throw new Error("Synchronisation E-user impossible. Mot de passe local indisponible.");
      }

      let createdEmployee = await userRemoteService.create({
        name: employee.name,
        email: employee.email,
        phone: employee.phone ?? "",
        password,
        role: "employe",
      });

      if (employee.is_active === false) {
        createdEmployee = await userRemoteService.update(createdEmployee.id, {
          is_active: false,
        });
      }

      await markLocalEmployeeAccountSynced(
        employee.id,
        {
          ...createdEmployee,
          phone: createdEmployee.phone || employee.phone || "",
        },
        { password },
      );
      return 1;
    }

    case "update": {
      const patch = buildEmployeeSyncUpdatePatch(employee);
      const updatedEmployee = await userRemoteService.update(employee.id, patch);

      await markLocalEmployeeAccountSynced(
        employee.id,
        {
          ...updatedEmployee,
          phone: updatedEmployee.phone || employee.phone || "",
        },
        { password: patch.password },
      );
      return 1;
    }

    case "delete": {
      try {
        await userRemoteService.delete(employee.id);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) {
          throw error;
        }
      }

      await deleteLocalEmployeeAccount(employee.id);
      return 1;
    }

    default:
      return 0;
  }
}

async function syncPendingEmployeeAccounts() {
  const pendingEmployees = await listPendingLocalEmployeeAccountSyncRecords();
  let syncedCount = 0;

  for (const employee of pendingEmployees) {
    try {
      syncedCount += await syncPendingEmployeeAccount(employee);
    } catch (error) {
      if (isApiUnavailableError(error)) {
        throw new Error("Synchronisation E-user impossible. Serveur indisponible.");
      }

      throw error;
    }
  }

  return syncedCount;
}

async function changeEmployeePasswordInLocalCredentialCache(
  currentUser: User,
  currentPassword: string,
  newPassword: string,
  options: { persistRemoteOfflineSession?: boolean } = {},
) {
  const verification = await authenticateOfflineCredential(currentUser.email, currentPassword);

  if (verification.status !== "success" || verification.user.id !== currentUser.id) {
    throw new Error("Mot de passe actuel incorrect.");
  }

  const employee = await updateStoredLocalEmployeeAccount(
    currentUser.id,
    { password: newPassword },
    {
      offline_enabled: true,
      sync_status: "local",
      pending_sync: false,
    },
  );

  if (options.persistRemoteOfflineSession) {
    await persistRemoteOfflineUserSession(
      {
        ...currentUser,
        id: employee.id,
        email: employee.email,
        phone: employee.phone,
        name: employee.name,
        role: employee.role,
        password: "",
      },
      newPassword,
    );
  }

  return employee;
}

function isPasswordChangeAuthorizationError(error: ApiError) {
  if (error.status === 401) {
    return true;
  }

  if (error.status !== 403) {
    return false;
  }

  const normalizedMessage = error.message
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return /^(forbidden|unauthorized|acces refuse)/.test(normalizedMessage);
}

export const changeCurrentEmployeePassword = async (
  input: EmployeePasswordChangeInput & { confirmPassword?: string },
): Promise<EmployeeAccount> => {
  const currentUser = getCurrentUser();

  if (!isEmployee(currentUser)) {
    throw new Error("Accès refusé.");
  }

  const currentPassword = input.currentPassword;
  const newPassword = input.newPassword.trim();
  const confirmPassword = input.confirmPassword?.trim();

  if (newPassword.length === 0) {
    throw new Error("Le nouveau mot de passe est obligatoire.");
  }

  if (newPassword.length < 6) {
    throw new Error("Le nouveau mot de passe doit contenir au moins 6 caractères.");
  }

  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    throw new Error("Les mots de passe ne correspondent pas.");
  }

  if (!usesServerModeForEmployees() || isRemoteAuthOfflineSession()) {
    return changeEmployeePasswordInLocalCredentialCache(
      currentUser,
      currentPassword,
      newPassword,
      { persistRemoteOfflineSession: !useLocalAuth },
    );
  }

  try {
    const employee = await userRemoteService.changeOwnPassword({
      currentPassword,
      newPassword,
    });
    const cachedEmployee = await upsertLocalEmployeeAccount(employee, {
      password: newPassword,
      offline_enabled: true,
      sync_status: "synced",
      pending_sync: false,
    });

    return {
      ...employee,
      displayPassword: cachedEmployee.displayPassword,
      phone: employee.phone || cachedEmployee.phone,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 0) {
      throw new Error("Impossible de modifier le mot de passe sur le serveur.");
    }

    if (error instanceof ApiError && isPasswordChangeAuthorizationError(error)) {
      try {
        return await changeEmployeePasswordInLocalCredentialCache(
          currentUser,
          currentPassword,
          newPassword,
          { persistRemoteOfflineSession: true },
        );
      } catch (fallbackError) {
        if (
          fallbackError instanceof Error &&
          fallbackError.message === "Mot de passe actuel incorrect."
        ) {
          throw fallbackError;
        }

        throw new Error("Vous n'êtes pas autorisé à effectuer cette action.");
      }
    }

    throw error;
  }
};

type EmployeeAccountDeleteResult = {
  localFallback: boolean;
  queuedSync: boolean;
};

export const deleteEmployeeAccount = async (id: string): Promise<EmployeeAccountDeleteResult> => {
  const currentUser = getCurrentUser();

  if (!isAdmin(currentUser)) {
    throw new Error("AccÃ¨s refusÃ©. Cette section est rÃ©servÃ©e Ã  l'administrateur.");
  }

  if (currentUser?.id === id) {
    throw new Error("Impossible de supprimer l'utilisateur connectÃ©.");
  }

  if (!usesServerModeForEmployees()) {
    await deleteLocalEmployeeAccount(id);
    return { localFallback: false, queuedSync: false };
  }

  try {
    await userRemoteService.delete(id);

    try {
      await deleteLocalEmployeeAccount(id);
    } catch {
      // The backend is authoritative in server mode; the local credential cache
      // may not contain the employee yet.
    }

    return { localFallback: false, queuedSync: false };
  } catch (error) {
    if (isApiUnavailableError(error)) {
      const localDelete = await markLocalEmployeeAccountDeleted(id);
      return { localFallback: true, queuedSync: localDelete.queued };
    }

    throw error;
  }
};

export const isOnline = () => isConnectionOnline();
export const setOnline = (v: boolean) => setConnectionTestOverride(v);
export const getLastSync = () => syncService.getLastSync();
export const getPendingCount = () => syncService.getPendingCount();
export const syncPendingData = () => syncService.syncPendingData();
