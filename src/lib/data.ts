/**
 * Backwards-compatible facade.
 *
 * The real implementation now lives under `src/domain`, `src/infrastructure`,
 * and `src/services/appServices.ts`. UI code should progressively migrate to
 * `import { ... } from "@/services/appServices"`.
 */
export {
  authService, clientService, paymentService, adminSettingsService,
  activityLogService, notificationService, syncService, seedIfNeeded,
  getCurrentUser, login, logout,
  getAllClients, getAllPayments, getClients, getClient, getClientReferenceById, createClient, updateClient, deleteClient,
  getPayments, getPaymentsByClient, createPayment, deletePayment, getLocalSyncStatus, getServerSyncStatus, getPaymentNotificationStatusMap, getPaymentNotificationStatuses,
  getAdminSettings, updateAdminSettings,
  testAdminSmtpEmail,
  changeLocalDatabaseLocation, chooseLocalDatabaseFolder, getLocalDatabaseLocation, openLocalDatabaseLocation,
  getActivityLogs, getNotifications,
  cleanupOldSentNotifications, clearSentNotifications,
  getEmployeeAccounts, createEmployeeAccount, updateEmployeeAccount, deleteEmployeeAccount,
  changeCurrentEmployeePassword,
  MAX_EMPLOYEES, EMPLOYEE_LIMIT_REACHED_MESSAGE, getEmployeeCount, hasReachedEmployeeLimit,
  isAdmin, isEmployee, isSameLocalDay, filterForCurrentUserDailyScope,
  isOnline, setOnline, getLastSync, getPendingCount, syncPendingData,
  resetDevelopmentTestData,
  formatTND, formatDateFR, formatDateTimeFR,
} from "@/services/appServices";

export {
  activateLicense,
  clearLicenseState,
  getLicenseAppVersion,
  getLicenseAccessSnapshot,
  getLicenseState,
  getStoredLicenseState,
  LICENSE_ACTIVATED_SUCCESS_MESSAGE,
  LICENSE_ACTIVATION_FAILED_MESSAGE,
  LICENSE_DEVICE_MISMATCH_MESSAGE,
  LICENSE_EXPIRED_MESSAGE,
  LICENSE_INVALID_MESSAGE,
  LICENSE_OFFLINE_ACTIVE_MESSAGE,
  LICENSE_REVOKED_MESSAGE,
  LICENSE_REQUIRED_MESSAGE,
  LICENSE_SUSPENDED_MESSAGE,
  LICENSE_GRACE_PERIOD_EXPIRED_MESSAGE,
  normalizeLicenseState,
  refreshLicenseState,
  saveLicenseState,
} from "@/services/licenseService";

export { DEMO_USERS as USERS } from "@/infrastructure/local/authLocalRepository";
