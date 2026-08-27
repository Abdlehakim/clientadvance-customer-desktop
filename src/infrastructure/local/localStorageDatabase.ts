/**
 * Legacy localStorage primitives.
 *
 * SQLite desktop storage is the only durable app data store. These keys remain
 * only so old snapshots can be imported and non-durable browser events can be
 * emitted during the transition.
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

export function uid() {
  const secureCrypto = globalThis.crypto;

  if (typeof secureCrypto?.randomUUID === "function") {
    return secureCrypto.randomUUID();
  }

  if (typeof secureCrypto?.getRandomValues !== "function") {
    throw new Error("Secure random UUID generation is unavailable.");
  }

  const bytes = secureCrypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));

  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function seedIfNeeded() {
  return;
}
