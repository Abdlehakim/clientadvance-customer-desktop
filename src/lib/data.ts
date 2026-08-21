import type { LicenseState, NormalizedLicenseState } from "@/domain/types";
import type { LicenseAccessSnapshot } from "@/services/licenseService";
import {
  getLicenseAppVersion,
  LICENSE_ACTIVATED_SUCCESS_MESSAGE,
  LICENSE_ACTIVATION_FAILED_MESSAGE,
  LICENSE_DEVICE_MISMATCH_MESSAGE,
  LICENSE_EXPIRED_MESSAGE,
  LICENSE_GRACE_PERIOD_EXPIRED_MESSAGE,
  LICENSE_INVALID_MESSAGE,
  LICENSE_OFFLINE_ACTIVE_MESSAGE,
  LICENSE_REQUIRED_MESSAGE,
  LICENSE_REVOKED_MESSAGE,
  LICENSE_SUSPENDED_MESSAGE,
  normalizeLicenseState,
} from "@/services/licenseService";

/**
 * Backwards-compatible facade.
 *
 * The real implementation now lives under `src/domain`, `src/infrastructure`,
 * and `src/services/appServices.ts`. UI code should progressively migrate to
 * `import { ... } from "@/services/appServices"`.
 */
export {
  authService,
  clientService,
  paymentService,
  adminSettingsService,
  activityLogService,
  notificationService,
  syncService,
  seedIfNeeded,
  getCurrentUser,
  login,
  logout,
  getAllClients,
  getAllPayments,
  getPaymentSelectableClients,
  getClients,
  getClient,
  getClientReferenceById,
  createClient,
  updateClient,
  deleteClient,
  getPayments,
  getPaymentsByClient,
  createPayment,
  deletePayment,
  getLocalSyncStatus,
  getServerSyncStatus,
  getPaymentNotificationStatusMap,
  getPaymentNotificationStatuses,
  getAdminSettings,
  updateAdminSettings,
  testAdminSmtpEmail,
  getStorageDiagnostics,
  cleanupLegacyLocalStorageData,
  changeLocalDatabaseLocation,
  chooseLocalDatabaseFolder,
  getLocalDatabaseLocation,
  openLocalDatabaseLocation,
  getActivityLogs,
  getNotifications,
  cleanupOldSentNotifications,
  clearSentNotifications,
  getEmployeeAccounts,
  createEmployeeAccount,
  updateEmployeeAccount,
  deleteEmployeeAccount,
  changeCurrentEmployeePassword,
  MAX_EMPLOYEES,
  EMPLOYEE_LIMIT_REACHED_MESSAGE,
  getEmployeeCount,
  hasReachedEmployeeLimit,
  isAdmin,
  isEmployee,
  isSameLocalDay,
  filterForCurrentUserDailyScope,
  isOnline,
  setOnline,
  getLastSync,
  getPendingCount,
  syncPendingData,
  resetDevelopmentTestData,
  formatTND,
  formatDateFR,
  formatDateTimeFR,
} from "@/services/appServices";

const DESKTOP_LICENSE_ROW_ID = "desktop-local";
const DESKTOP_LICENSE_CUSTOMER_NAME = "ClientAdvans Desktop";
const DESKTOP_LICENSE_TOKEN = "desktop-local-access";
const DESKTOP_LICENSE_KEY_MASKED = "DESKTOP-LOCAL";

function nowIso() {
  return new Date().toISOString();
}

function buildDesktopLicenseState(): LicenseState {
  const timestamp = nowIso();

  return {
    id: DESKTOP_LICENSE_ROW_ID,
    license_key_hash: "desktop-local",
    license_token: DESKTOP_LICENSE_TOKEN,
    device_id: "desktop-local-device",
    license_status: "active",
    company_id: "desktop-local",
    company_name: DESKTOP_LICENSE_CUSTOMER_NAME,
    customer_name: DESKTOP_LICENSE_CUSTOMER_NAME,
    activated_at: timestamp,
    expires_at: null,
    last_checked_at: timestamp,
    last_validated_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function buildDesktopNormalizedLicenseState(): NormalizedLicenseState {
  const state = buildDesktopLicenseState();

  return {
    licenseToken: state.license_token,
    deviceId: state.device_id,
    licenseStatus: "active",
    companyId: state.company_id,
    companyName: state.company_name,
    customerName: state.customer_name,
    activatedAt: state.activated_at,
    expiresAt: null,
    lastCheckedAt: state.last_checked_at,
    lastValidatedAt: state.last_validated_at,
    licenseKeyMasked: DESKTOP_LICENSE_KEY_MASKED,
  };
}

function buildDesktopLicenseAccessSnapshot(): LicenseAccessSnapshot {
  return {
    state: buildDesktopLicenseState(),
    status: "active",
    requiresActivation: false,
    message: "",
    offlineActive: false,
    isDevBypass: false,
  };
}

export async function activateLicense(_input: { licenseKey: string; customerName?: string }) {
  return buildDesktopLicenseAccessSnapshot();
}
export async function clearLicenseState() {
  // Desktop-only build: access is local and does not depend on a stored server licence.
}

export async function getLicenseAccessSnapshot() {
  return buildDesktopLicenseAccessSnapshot();
}

export async function getLicenseState() {
  return buildDesktopNormalizedLicenseState();
}

export async function getStoredLicenseState() {
  return buildDesktopLicenseState();
}

export async function refreshLicenseState() {
  return buildDesktopLicenseAccessSnapshot();
}

export async function saveLicenseState(_state: LicenseState) {
  // Desktop-only build: keep licence access independent from the server state.
}

export {
  getLicenseAppVersion,
  LICENSE_ACTIVATED_SUCCESS_MESSAGE,
  LICENSE_ACTIVATION_FAILED_MESSAGE,
  LICENSE_DEVICE_MISMATCH_MESSAGE,
  LICENSE_EXPIRED_MESSAGE,
  LICENSE_GRACE_PERIOD_EXPIRED_MESSAGE,
  LICENSE_INVALID_MESSAGE,
  LICENSE_OFFLINE_ACTIVE_MESSAGE,
  LICENSE_REQUIRED_MESSAGE,
  LICENSE_REVOKED_MESSAGE,
  LICENSE_SUSPENDED_MESSAGE,
  normalizeLicenseState,
};

export { DEMO_USERS as USERS } from "@/infrastructure/local/authLocalRepository";
