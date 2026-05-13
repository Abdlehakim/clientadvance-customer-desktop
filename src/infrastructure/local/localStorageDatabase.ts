/**
 * LocalStorage-backed primitives.
 *
 * Browser/dev mode still uses these keys as the primary data store.
 * In Tauri/SQLite mode, business data keys are used only as a temporary sync
 * bridge or browser-session projection and must not be treated as durable data.
 */
export const KEYS = {
  clients: "gcp_clients",
  payments: "gcp_payments",
  logs: "gcp_logs",
  settings: "gcp_settings",
  smtpPassword: "gcp_smtp_password",
  notifications: "gcp_notifications",
  user: "gcp_user",
  localUsers: "gcp_local_users",
  offlineCredentials: "gcp_offline_credentials",
  authSessionMode: "gcp_auth_session_mode",
  online: "gcp_online",
  onlineOverride: "gcp_online_override",
  lastSync: "gcp_last_sync",
  licenseState: "gcp_license_state",
  licenseDeviceIdentity: "gcp_license_device_identity",
  syncBridgeActive: "gcp_sync_bridge_active",
  seeded: "gcp_seeded_v1",
} as const;

export const SYNC_BRIDGE_KEYS = [
  KEYS.clients,
  KEYS.payments,
  KEYS.settings,
  KEYS.logs,
  KEYS.notifications,
  KEYS.lastSync,
] as const;

export const isBrowser = () => typeof window !== "undefined";

export function read<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function readBoolean(key: string, fallback: boolean): boolean {
  const value = read<unknown>(key, fallback);

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }

  return fallback;
}

export function write<T>(key: string, value: T) {
  if (!isBrowser()) return;
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("gcp:data-change"));
}

export function emitChange() {
  if (isBrowser()) window.dispatchEvent(new CustomEvent("gcp:data-change"));
}

export function clearLocalStorageKeys(
  keys: readonly string[],
  options: { emit?: boolean } = {},
) {
  if (!isBrowser()) return;

  for (const key of keys) {
    localStorage.removeItem(key);
  }

  if (options.emit) {
    emitChange();
  }
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export function seedIfNeeded() {
  if (!isBrowser()) return;
  const hasSeedFlag = localStorage.getItem(KEYS.seeded) !== null;
  const hasSeededSnapshot = [
    KEYS.clients,
    KEYS.payments,
    KEYS.settings,
    KEYS.logs,
    KEYS.notifications,
  ].every((key) => localStorage.getItem(key) !== null);

  if (hasSeedFlag && hasSeededSnapshot) return;
  const now = new Date().toISOString();
  const settings = {
    id: "settings_default",
    admin_email: "",
    admin_whatsapp: "",
    notification_retention_days: 30,
    setup_completed: false,
    server_mode: "with-server",
    notification_delivery_mode: "backend",
    smtp_provider_type: "gmail",
    smtp_host: "",
    smtp_port: 587,
    smtp_username: "",
    smtp_password_configured: false,
    smtp_secure: true,
    smtp_from_email: "",
    smtp_from_name: "",
    updated_at: now,
    updated_by: "",
    remote_updated_at: now,
    pending_sync: false,
    sync_status: "synced",
  };
  localStorage.setItem(KEYS.clients, JSON.stringify([]));
  localStorage.setItem(KEYS.payments, JSON.stringify([]));
  localStorage.setItem(KEYS.settings, JSON.stringify(settings));
  localStorage.setItem(KEYS.logs, JSON.stringify([]));
  localStorage.setItem(KEYS.notifications, JSON.stringify([]));
  localStorage.setItem(KEYS.seeded, "1");
}
