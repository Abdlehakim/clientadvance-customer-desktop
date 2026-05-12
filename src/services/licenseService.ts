import type {
  DecodedLicenseToken,
  LicenseActivationResponse,
  LicenseCheckResponse,
  LicenseState,
  LicenseStateStatus,
  NormalizedLicenseState,
} from "@/domain/types";
import {
  clearLocalStorageKeys,
  emitChange,
  KEYS,
  read,
  write,
} from "@/infrastructure/local/localStorageDatabase";
import {
  getDb,
  getOrCreateDeviceId,
  type SqliteRow,
} from "@/infrastructure/local/sqlite/sqliteClient";
import {
  ApiError,
  buildApiUrl,
  getApiPayloadMessage,
} from "@/infrastructure/remote/apiClient";
import { isConnectionOnline } from "@/services/connectionService";
import { initializeStorageDriver, useSQLiteStorage } from "./appServices";
import { persistOwnerControlledAdminModes } from "./ownerControlledModeService";

const env = import.meta.env as ImportMetaEnv & {
  VITE_LICENSE_DEV_BYPASS?: string;
  VITE_APP_VERSION?: string;
};

const LICENSE_ROW_ID = "primary";
const LICENSE_DEV_BYPASS_ENABLED = env.VITE_LICENSE_DEV_BYPASS === "true";
const APP_VERSION = env.VITE_APP_VERSION;
const APP_IDENTIFIER = "com.gestionfacile.desktop";
const IS_DEV = import.meta.env.DEV;
const LICENSE_OFFLINE_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export const LICENSE_STATE_CHANGE_EVENT = "gcp:license-state-change";
export const LICENSE_REQUIRED_MESSAGE = "Activation requise pour cet appareil.";
export const LICENSE_ACTIVATED_SUCCESS_MESSAGE =
  "Licence activee pour cet appareil.";
export const LICENSE_ACTIVATION_FAILED_MESSAGE =
  "Activation impossible. Verifiez votre cle de licence.";
export const LICENSE_INVALID_MESSAGE = "Licence invalide.";
export const LICENSE_REVOKED_MESSAGE =
  "Licence desactivee. Veuillez contacter le support.";
export const LICENSE_SUSPENDED_MESSAGE =
  "Licence suspendue. Veuillez contacter le support.";
export const LICENSE_DEVICE_MISMATCH_MESSAGE =
  "Cette licence n'est pas valide pour cet appareil.";
export const LICENSE_EXPIRED_MESSAGE =
  "Licence expiree. Veuillez renouveler votre licence.";
export const LICENSE_OFFLINE_ACTIVE_MESSAGE =
  "Mode hors ligne : licence deja activee.";
export const LICENSE_GRACE_PERIOD_EXPIRED_MESSAGE =
  "Connexion au serveur requise pour verifier la licence.";

export type LicenseAccessStatus =
  | "active"
  | "missing"
  | "invalid"
  | "expired"
  | "revoked"
  | "suspended"
  | "dev-bypass";

export interface LicenseAccessSnapshot {
  state: LicenseState | null;
  status: LicenseAccessStatus;
  requiresActivation: boolean;
  message: string;
  offlineActive: boolean;
  isDevBypass: boolean;
}

interface LicenseStateRow extends SqliteRow {
  id: unknown;
  license_key_hash: unknown;
  license_token: unknown;
  device_id: unknown;
  license_status: unknown;
  company_id: unknown;
  company_name: unknown;
  customer_name: unknown;
  activated_at: unknown;
  expires_at: unknown;
  last_checked_at: unknown;
  last_validated_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface LicenseActivationInput {
  licenseKey: string;
  customerName?: string;
}

interface ValidationErrorPayload {
  fieldErrors?: Record<string, string[] | undefined>;
  formErrors?: string[];
}

type LicenseStateInput = Partial<Record<string, unknown>>;
type LicenseTokenPayloadInput = Partial<Record<string, unknown>>;

interface BrowserDeviceIdentity {
  installSecret: string;
}

let currentDeviceIdPromise: Promise<string> | null = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeLicenseKey(value: string) {
  return value.trim().toUpperCase();
}

function normalizeOptionalString(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDeviceId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getValidationErrorMessage(payload: unknown) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("errors" in payload) ||
    typeof payload.errors !== "object" ||
    payload.errors === null
  ) {
    return null;
  }

  const errors = payload.errors as ValidationErrorPayload;
  const fieldErrors = errors.fieldErrors ?? {};

  for (const value of Object.values(fieldErrors)) {
    const message = value?.find((entry) => typeof entry === "string" && entry.trim().length > 0);

    if (message) {
      return message.trim();
    }
  }

  const formMessage = errors.formErrors?.find(
    (entry) => typeof entry === "string" && entry.trim().length > 0,
  );

  return formMessage?.trim() ?? null;
}

function getLicenseApiErrorDetails(payload: unknown) {
  const payloadMessage = getApiPayloadMessage(payload);
  const validationMessage = getValidationErrorMessage(payload);
  return validationMessage ?? payloadMessage;
}

function logLicenseActivationDebug(message: string, details: Record<string, unknown>) {
  if (!IS_DEV) {
    return;
  }

  console.info(`[license] ${message}`, details);
}

function logLicenseActivationError(message: string, details: Record<string, unknown>) {
  if (!IS_DEV) {
    return;
  }

  console.error(`[license] ${message}`, details);
}

function emitLicenseStateChange() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(LICENSE_STATE_CHANGE_EVENT));
}

function fallbackHash(value: string) {
  let hash = 5381;

  for (const character of value) {
    hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
  }

  return `fallback-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function hashTextSha256(value: string) {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );

    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  return fallbackHash(value);
}

async function hashLicenseKey(value: string) {
  return hashTextSha256(normalizeLicenseKey(value));
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readOptionalTrimmedString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
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

function normalizeTimestamp(value: unknown) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    return null;
  }

  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function normalizeUnixTimestamp(value: unknown) {
  const seconds =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : null;

  if (!Number.isFinite(seconds)) {
    return null;
  }

  return new Date((seconds as number) * 1000).toISOString();
}

function normalizeRequiredTimestamp(value: unknown, fallbackValue?: unknown) {
  return normalizeTimestamp(value) ?? normalizeTimestamp(fallbackValue) ?? nowIso();
}

function readLicenseStatus(value: unknown): LicenseStateStatus {
  return value === "active" ||
    value === "expired" ||
    value === "invalid" ||
    value === "revoked" ||
    value === "suspended"
    ? value
    : "invalid";
}

function toLicenseState(row: LicenseStateRow | LicenseStateInput): LicenseState {
  const createdAt = normalizeRequiredTimestamp(
    readRecordValue(row, "created_at", "createdAt"),
  );
  const activatedAt = normalizeRequiredTimestamp(
    readRecordValue(row, "activated_at", "activatedAt"),
    createdAt,
  );
  const updatedAt = normalizeRequiredTimestamp(
    readRecordValue(row, "updated_at", "updatedAt"),
    activatedAt,
  );

  return {
    id: readString(readRecordValue(row, "id"), LICENSE_ROW_ID),
    license_key_hash: readString(
      readRecordValue(row, "license_key_hash", "licenseKeyHash"),
    ),
    license_token: readString(readRecordValue(row, "license_token", "licenseToken")),
    device_id: normalizeDeviceId(readRecordValue(row, "device_id", "deviceId")) ?? "",
    license_status: readLicenseStatus(
      readRecordValue(row, "license_status", "licenseStatus"),
    ),
    company_id: readNullableString(readRecordValue(row, "company_id", "companyId")),
    company_name: readNullableString(
      readRecordValue(row, "company_name", "companyName"),
    ),
    customer_name: readNullableString(
      readRecordValue(row, "customer_name", "customerName"),
    ),
    activated_at: activatedAt,
    expires_at: normalizeTimestamp(readRecordValue(row, "expires_at", "expiresAt")),
    last_checked_at: normalizeTimestamp(
      readRecordValue(row, "last_checked_at", "lastCheckedAt"),
    ),
    last_validated_at: normalizeTimestamp(
      readRecordValue(row, "last_validated_at", "lastValidatedAt"),
    ),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function normalizeLicenseState(raw: unknown): NormalizedLicenseState | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const record = raw as LicenseStateInput;
  const licenseToken =
    readOptionalTrimmedString(readRecordValue(record, "license_token", "licenseToken")) ?? "";
  const deviceId = normalizeDeviceId(readRecordValue(record, "device_id", "deviceId"));
  const licenseStatus = readLicenseStatus(
    readRecordValue(record, "license_status", "licenseStatus"),
  );
  const companyId = readOptionalTrimmedString(
    readRecordValue(record, "company_id", "companyId"),
  );
  const companyName = readOptionalTrimmedString(
    readRecordValue(record, "company_name", "companyName"),
  );
  const customerName = readOptionalTrimmedString(
    readRecordValue(record, "customer_name", "customerName"),
  );
  const activatedAt = normalizeTimestamp(
    readRecordValue(record, "activated_at", "activatedAt"),
  );
  const expiresAt = normalizeTimestamp(readRecordValue(record, "expires_at", "expiresAt"));
  const lastCheckedAt = normalizeTimestamp(
    readRecordValue(record, "last_checked_at", "lastCheckedAt"),
  );
  const lastValidatedAt = normalizeTimestamp(
    readRecordValue(record, "last_validated_at", "lastValidatedAt"),
  );
  const licenseKeyMasked = readOptionalTrimmedString(
    readRecordValue(record, "license_key_masked", "licenseKeyMasked"),
  );

  const hasData =
    licenseToken.length > 0 ||
    deviceId !== null ||
    companyId !== null ||
    companyName !== null ||
    customerName !== null ||
    activatedAt !== null ||
    expiresAt !== null ||
    lastCheckedAt !== null ||
    lastValidatedAt !== null ||
    licenseKeyMasked !== null ||
    readRecordValue(record, "license_status", "licenseStatus") !== undefined;

  if (!hasData) {
    return null;
  }

  return {
    licenseToken,
    deviceId,
    licenseStatus,
    companyId,
    companyName,
    customerName,
    activatedAt,
    expiresAt,
    lastCheckedAt,
    lastValidatedAt,
    licenseKeyMasked,
  };
}

function isExpiredDate(expiresAt: string | null) {
  if (typeof expiresAt !== "string" || expiresAt.trim().length === 0) {
    return false;
  }

  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function buildBypassState(): LicenseState {
  const timestamp = nowIso();

  return {
    id: LICENSE_ROW_ID,
    license_key_hash: "dev-bypass",
    license_token: "dev-bypass",
    device_id: "dev-bypass",
    license_status: "active",
    company_id: "dev-bypass",
    company_name: "Developpement",
    customer_name: "Developpement",
    activated_at: timestamp,
    expires_at: null,
    last_checked_at: timestamp,
    last_validated_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

async function readSqliteLicenseState() {
  const db = await getDb();
  const rows = await db.query<LicenseStateRow>(
    `
      SELECT
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
      FROM license_state
      WHERE id = ?
      LIMIT 1
    `,
    [LICENSE_ROW_ID],
  );

  return rows[0] ? toLicenseState(rows[0]) : null;
}

function readLocalStorageLicenseState() {
  const value = read<LicenseState | null>(KEYS.licenseState, null);
  return value ? toLicenseState(value as unknown as LicenseStateInput) : null;
}

async function writeSqliteLicenseState(state: LicenseState) {
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
      state.id,
      state.license_key_hash,
      state.license_token,
      state.device_id,
      state.license_status,
      state.company_id,
      state.company_name,
      state.customer_name,
      state.activated_at,
      state.expires_at,
      state.last_checked_at,
      state.last_validated_at,
      state.created_at,
      state.updated_at,
    ],
  );
}

function writeLocalStorageLicenseState(state: LicenseState) {
  write(KEYS.licenseState, state);
}

async function deleteSqliteLicenseState() {
  const db = await getDb();
  await db.execute("DELETE FROM license_state WHERE id = ?", [LICENSE_ROW_ID]);
}

function deleteLocalStorageLicenseState() {
  clearLocalStorageKeys([KEYS.licenseState], { emit: true });
}

function createBrowserInstallSecret() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replaceAll("-", "").toLowerCase();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);

    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function readBrowserDeviceIdentity() {
  const value = read<BrowserDeviceIdentity | null>(KEYS.licenseDeviceIdentity, null);

  if (typeof value !== "object" || value === null) {
    return null;
  }

  const installSecret = readOptionalTrimmedString(
    (value as Record<string, unknown>).installSecret,
  );

  return installSecret ? { installSecret } : null;
}

function writeBrowserDeviceIdentity(identity: BrowserDeviceIdentity) {
  write(KEYS.licenseDeviceIdentity, identity);
}

function getBrowserDeviceMaterial(installSecret: string) {
  const platform =
    typeof navigator !== "undefined" && typeof navigator.platform === "string"
      ? navigator.platform
      : "unknown-platform";
  const userAgent =
    typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
      ? navigator.userAgent
      : "unknown-user-agent";

  return `${installSecret}:${APP_IDENTIFIER}:${platform}:${userAgent}`;
}

async function getOrCreateBrowserDeviceId() {
  const existingIdentity = readBrowserDeviceIdentity();
  const installSecret = existingIdentity?.installSecret ?? createBrowserInstallSecret();

  if (!existingIdentity) {
    writeBrowserDeviceIdentity({ installSecret });
  }

  const deviceId = await hashTextSha256(getBrowserDeviceMaterial(installSecret));
  return normalizeDeviceId(deviceId) ?? fallbackHash(getBrowserDeviceMaterial(installSecret));
}

async function resolveCurrentDeviceId() {
  if (useSQLiteStorage) {
    const deviceId = normalizeDeviceId(await getOrCreateDeviceId());

    if (!deviceId) {
      throw new Error("Impossible de lire l'identite locale de cet appareil.");
    }

    return deviceId;
  }

  return getOrCreateBrowserDeviceId();
}

export async function getCurrentDeviceId() {
  currentDeviceIdPromise ??= resolveCurrentDeviceId().catch((error) => {
    currentDeviceIdPromise = null;
    throw error;
  });

  return currentDeviceIdPromise;
}

function decodeBase64UrlSegment(segment: string) {
  if (typeof atob !== "function") {
    return null;
  }

  const normalized = segment.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");

  try {
    return atob(padded);
  } catch {
    return null;
  }
}

function decodeLicenseToken(token: string): DecodedLicenseToken | null {
  const parts = token.split(".");

  if (parts.length < 2) {
    return null;
  }

  const payloadJson = decodeBase64UrlSegment(parts[1]);

  if (!payloadJson) {
    return null;
  }

  const payload = safeJson(payloadJson);

  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const record = payload as LicenseTokenPayloadInput;
  const type = readOptionalTrimmedString(readRecordValue(record, "type", "typ"));
  const licenseId = readOptionalTrimmedString(
    readRecordValue(record, "license_id", "licenseId"),
  );
  const companyId = readOptionalTrimmedString(
    readRecordValue(record, "company_id", "companyId"),
  );
  const companyName = readOptionalTrimmedString(
    readRecordValue(record, "company_name", "companyName"),
  );
  const customerName = readOptionalTrimmedString(
    readRecordValue(record, "customer_name", "customerName"),
  );
  const deviceId = normalizeDeviceId(readRecordValue(record, "device_id", "deviceId"));
  const expiresAt = normalizeTimestamp(
    readRecordValue(record, "expires_at", "expiresAt"),
  );
  const issuedAt =
    normalizeTimestamp(readRecordValue(record, "issued_at", "issuedAt")) ??
    normalizeUnixTimestamp(readRecordValue(record, "iat"));
  const appVersion = readOptionalTrimmedString(
    readRecordValue(record, "app_version", "appVersion"),
  );
  const status = readOptionalTrimmedString(readRecordValue(record, "status"));
  const tokenExpiresAt = normalizeUnixTimestamp(readRecordValue(record, "exp"));

  const hasData =
    type !== null ||
    licenseId !== null ||
    companyId !== null ||
    companyName !== null ||
    customerName !== null ||
    deviceId !== null ||
    expiresAt !== null ||
    issuedAt !== null ||
    appVersion !== null ||
    status !== null ||
    tokenExpiresAt !== null;

  if (!hasData) {
    return null;
  }

  return {
    type,
    licenseId,
    companyId,
    companyName,
    customerName,
    deviceId,
    expiresAt,
    issuedAt,
    appVersion,
    status,
    tokenExpiresAt,
  };
}

function createLockedSnapshot(
  state: LicenseState,
  status: Extract<LicenseAccessStatus, "invalid" | "expired" | "revoked" | "suspended">,
  message: string,
): LicenseAccessSnapshot {
  return {
    state,
    status,
    requiresActivation: true,
    message,
    offlineActive: false,
    isDevBypass: false,
  };
}

function getLastValidatedAt(state: LicenseState) {
  return state.last_validated_at ?? state.activated_at;
}

function isWithinOfflineGrace(state: LicenseState) {
  const reference = getLastValidatedAt(state);
  const timestamp = Date.parse(reference);

  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return Date.now() - timestamp <= LICENSE_OFFLINE_GRACE_PERIOD_MS;
}

function createBackendUnavailableSnapshot(state: LicenseState): LicenseAccessSnapshot {
  if (state.license_status === "revoked") {
    return createLockedSnapshot(state, "revoked", LICENSE_REVOKED_MESSAGE);
  }

  if (state.license_status === "suspended") {
    return createLockedSnapshot(state, "suspended", LICENSE_SUSPENDED_MESSAGE);
  }

  if (state.license_status === "expired" || isExpiredDate(state.expires_at)) {
    return createLockedSnapshot(state, "expired", LICENSE_EXPIRED_MESSAGE);
  }

  if (state.license_status !== "active") {
    return createLockedSnapshot(state, "invalid", LICENSE_INVALID_MESSAGE);
  }

  if (isWithinOfflineGrace(state)) {
    return {
      state,
      status: "active",
      requiresActivation: false,
      message: LICENSE_OFFLINE_ACTIVE_MESSAGE,
      offlineActive: true,
      isDevBypass: false,
    };
  }

  return createLockedSnapshot(state, "invalid", LICENSE_GRACE_PERIOD_EXPIRED_MESSAGE);
}

function resolveApiFailureMessage(error: unknown) {
  if (error instanceof ApiError) {
    const details =
      typeof error.payload === "object" && error.payload !== null && "details" in error.payload
        ? error.payload.details
        : null;
    const detailStatus =
      typeof details === "object" && details !== null && "status" in details
        ? details.status
        : null;
    const payloadMessage = getLicenseApiErrorDetails(error.payload) ?? error.message;

    if (detailStatus === "expired") {
      return LICENSE_EXPIRED_MESSAGE;
    }

    if (detailStatus === "revoked") {
      return LICENSE_REVOKED_MESSAGE;
    }

    if (detailStatus === "suspended") {
      return LICENSE_SUSPENDED_MESSAGE;
    }

    if (detailStatus === "invalid" || error.status === 404) {
      return LICENSE_INVALID_MESSAGE;
    }

    if (payloadMessage.trim().length > 0) {
      return payloadMessage;
    }
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return LICENSE_ACTIVATION_FAILED_MESSAGE;
}

export async function getStoredLicenseState() {
  if (LICENSE_DEV_BYPASS_ENABLED) {
    return buildBypassState();
  }

  await initializeStorageDriver();
  return useSQLiteStorage ? readSqliteLicenseState() : readLocalStorageLicenseState();
}

export async function saveLicenseState(state: LicenseState) {
  await initializeStorageDriver();

  if (useSQLiteStorage) {
    await writeSqliteLicenseState(state);
    emitChange();
    emitLicenseStateChange();
    return;
  }

  writeLocalStorageLicenseState(state);
  emitLicenseStateChange();
}

export async function clearLicenseState() {
  await initializeStorageDriver();

  if (useSQLiteStorage) {
    await deleteSqliteLicenseState();
    emitChange();
    emitLicenseStateChange();
    return;
  }

  deleteLocalStorageLicenseState();
  emitLicenseStateChange();
}

export async function getLicenseState() {
  return normalizeLicenseState(await getStoredLicenseState());
}

export function getLicenseAppVersion() {
  return typeof APP_VERSION === "string" && APP_VERSION.trim().length > 0
    ? APP_VERSION.trim()
    : null;
}

async function requestLicenseCheck(state: LicenseState, deviceId: string) {
  const url = buildApiUrl("licenses/check");
  const payload = {
    license_token: state.license_token,
    device_id: deviceId,
    app_version: getLicenseAppVersion() ?? undefined,
  };

  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new ApiError(
      0,
      null,
      error instanceof Error ? error.message : LICENSE_ACTIVATION_FAILED_MESSAGE,
    );
  }

  const rawText = await response.text();
  const responsePayload = rawText ? safeJson(rawText) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      responsePayload,
      getLicenseApiErrorDetails(responsePayload) ?? `API ${response.status} sur ${url}`,
    );
  }

  return responsePayload as LicenseCheckResponse;
}

async function requestLicenseActivation(input: LicenseActivationInput, deviceId: string) {
  const url = buildApiUrl("licenses/activate");
  const payload = {
    license_key: normalizeLicenseKey(input.licenseKey),
    device_id: deviceId,
    customer_name: normalizeOptionalString(input.customerName) ?? undefined,
    app_version: getLicenseAppVersion() ?? undefined,
  };

  logLicenseActivationDebug("activation request", {
    url,
    hasDeviceId: true,
    hasCustomerName: typeof payload.customer_name === "string",
    hasAppVersion: typeof payload.app_version === "string",
  });

  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0
        ? error.message
        : LICENSE_ACTIVATION_FAILED_MESSAGE;

    logLicenseActivationError("activation network error", { url, message });
    throw new ApiError(0, null, message);
  }

  const rawText = await response.text();
  const responsePayload = rawText ? safeJson(rawText) : null;

  logLicenseActivationDebug("activation response", {
    url,
    status: response.status,
    ok: response.ok,
  });

  if (!response.ok) {
    const message =
      getLicenseApiErrorDetails(responsePayload) ??
      `API ${response.status} sur ${url}`;

    logLicenseActivationError("activation backend error", {
      url,
      status: response.status,
      message,
    });

    throw new ApiError(response.status, responsePayload, message);
  }

  return responsePayload as LicenseActivationResponse;
}

async function persistFailedActivationState(
  input: LicenseActivationInput,
  status: Extract<LicenseStateStatus, "expired" | "invalid" | "revoked" | "suspended">,
  deviceId: string,
) {
  const existing = await getStoredLicenseState();
  const timestamp = nowIso();
  const licenseKeyHash = await hashLicenseKey(input.licenseKey);

  await saveLicenseState({
    id: LICENSE_ROW_ID,
    license_key_hash: licenseKeyHash,
    license_token: "",
    device_id: deviceId,
    license_status: status,
    company_id: existing?.company_id ?? null,
    company_name: existing?.company_name ?? null,
    customer_name: normalizeOptionalString(input.customerName),
    activated_at: existing?.activated_at ?? timestamp,
    expires_at: existing?.expires_at ?? null,
    last_checked_at: timestamp,
    last_validated_at: existing?.last_validated_at ?? existing?.activated_at ?? null,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
  });
}

async function createActiveLicenseState(
  input: LicenseActivationInput,
  response: LicenseActivationResponse,
  currentDeviceId: string,
) {
  const existing = await getStoredLicenseState();
  const timestamp = nowIso();

  return {
    id: LICENSE_ROW_ID,
    license_key_hash: await hashLicenseKey(input.licenseKey),
    license_token: response.license_token,
    device_id: normalizeDeviceId(response.device_id) ?? currentDeviceId,
    license_status: "active" as const,
    company_id: response.company_id ?? null,
    company_name: response.company_name ?? response.customer_name ?? normalizeOptionalString(input.customerName),
    customer_name: response.customer_name ?? response.company_name ?? normalizeOptionalString(input.customerName),
    activated_at: timestamp,
    expires_at: normalizeTimestamp(response.expires_at),
    last_checked_at: timestamp,
    last_validated_at: timestamp,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
  } satisfies LicenseState;
}

export async function refreshLicenseState() {
  if (LICENSE_DEV_BYPASS_ENABLED) {
    return getLicenseAccessSnapshot();
  }

  const state = await getStoredLicenseState();

  if (!state) {
    return getLicenseAccessSnapshot();
  }

  const timestamp = nowIso();
  const baseState: LicenseState = {
    ...state,
    last_checked_at: timestamp,
    updated_at: timestamp,
  };

  await saveLicenseState(baseState);

  if (state.license_token.trim().length === 0) {
    return getLicenseAccessSnapshot();
  }

  const deviceId = await getCurrentDeviceId();

  try {
    const response = await requestLicenseCheck(baseState, deviceId);

    if (response.status === "active") {
      await persistOwnerControlledAdminModes(response);
      const checkedAt = normalizeTimestamp(response.checked_at) ?? timestamp;
      const nextState: LicenseState = {
        ...baseState,
        device_id: deviceId,
        license_status: "active",
        company_id: response.company_id ?? baseState.company_id,
        company_name:
          response.company_name ?? response.customer_name ?? baseState.company_name,
        customer_name:
          response.customer_name ?? response.company_name ?? baseState.customer_name,
        expires_at: normalizeTimestamp(response.expires_at) ?? baseState.expires_at,
        last_checked_at: checkedAt,
        last_validated_at: checkedAt,
        updated_at: checkedAt,
      };

      await saveLicenseState(nextState);
      return getLicenseAccessSnapshot();
    }

    const nextState: LicenseState = {
      ...baseState,
      license_status: response.status,
      updated_at: timestamp,
    };

    await saveLicenseState(nextState);
    return createLockedSnapshot(
      nextState,
      response.status,
      response.status === "revoked"
        ? LICENSE_REVOKED_MESSAGE
        : response.status === "suspended"
          ? LICENSE_SUSPENDED_MESSAGE
          : LICENSE_EXPIRED_MESSAGE,
    );
  } catch (error) {
    const message = resolveApiFailureMessage(error);

    if (error instanceof ApiError && (error.status === 0 || error.status >= 500)) {
      return createBackendUnavailableSnapshot(baseState);
    }

    if (message === LICENSE_REVOKED_MESSAGE) {
      const nextState: LicenseState = {
        ...baseState,
        license_status: "revoked",
      };

      await saveLicenseState(nextState);
      return createLockedSnapshot(nextState, "revoked", message);
    }

    if (message === LICENSE_SUSPENDED_MESSAGE) {
      const nextState: LicenseState = {
        ...baseState,
        license_status: "suspended",
      };

      await saveLicenseState(nextState);
      return createLockedSnapshot(nextState, "suspended", message);
    }

    if (message === LICENSE_EXPIRED_MESSAGE) {
      const nextState: LicenseState = {
        ...baseState,
        license_status: "expired",
      };

      await saveLicenseState(nextState);
      return createLockedSnapshot(nextState, "expired", message);
    }

    if (message === LICENSE_INVALID_MESSAGE) {
      const nextState: LicenseState = {
        ...baseState,
        license_status: "invalid",
      };

      await saveLicenseState(nextState);
      return createLockedSnapshot(nextState, "invalid", message);
    }

    return createBackendUnavailableSnapshot(baseState);
  }
}

export async function getLicenseAccessSnapshot(): Promise<LicenseAccessSnapshot> {
  if (LICENSE_DEV_BYPASS_ENABLED) {
    return {
      state: buildBypassState(),
      status: "dev-bypass",
      requiresActivation: false,
      message: "",
      offlineActive: false,
      isDevBypass: true,
    };
  }

  const state = await getStoredLicenseState();

  if (!state) {
    return {
      state: null,
      status: "missing",
      requiresActivation: true,
      message: LICENSE_REQUIRED_MESSAGE,
      offlineActive: false,
      isDevBypass: false,
    };
  }

  if (state.license_status === "revoked") {
    return createLockedSnapshot(state, "revoked", LICENSE_REVOKED_MESSAGE);
  }

  if (state.license_status === "suspended") {
    return createLockedSnapshot(state, "suspended", LICENSE_SUSPENDED_MESSAGE);
  }

  if (state.license_status === "expired" || isExpiredDate(state.expires_at)) {
    if (state.license_status !== "expired") {
      await saveLicenseState({
        ...state,
        license_status: "expired",
        updated_at: nowIso(),
      });
    }

    return createLockedSnapshot(
      { ...state, license_status: "expired" },
      "expired",
      LICENSE_EXPIRED_MESSAGE,
    );
  }

  if (state.license_status !== "active" || state.license_token.trim().length === 0) {
    return createLockedSnapshot(state, "invalid", LICENSE_INVALID_MESSAGE);
  }

  const decodedToken = decodeLicenseToken(state.license_token);

  if (!decodedToken || decodedToken.type !== "license" || !decodedToken.licenseId) {
    return createLockedSnapshot(state, "invalid", LICENSE_REQUIRED_MESSAGE);
  }

  if (isExpiredDate(decodedToken.expiresAt) || isExpiredDate(decodedToken.tokenExpiresAt)) {
    return createLockedSnapshot(
      { ...state, license_status: "expired" },
      "expired",
      LICENSE_EXPIRED_MESSAGE,
    );
  }

  if (decodedToken.status !== null && decodedToken.status !== "active") {
    return createLockedSnapshot(state, "invalid", LICENSE_INVALID_MESSAGE);
  }

  if (!decodedToken.deviceId) {
    return createLockedSnapshot(state, "invalid", LICENSE_REQUIRED_MESSAGE);
  }

  const currentDeviceId = await getCurrentDeviceId();
  const storedDeviceId = normalizeDeviceId(state.device_id);

  if (storedDeviceId && decodedToken.deviceId !== storedDeviceId) {
    if (IS_DEV) {
      console.error("[license] token device_id does not match stored license state.");
    }

    return createLockedSnapshot(state, "invalid", LICENSE_DEVICE_MISMATCH_MESSAGE);
  }

  if (
    (storedDeviceId && storedDeviceId !== currentDeviceId) ||
    decodedToken.deviceId !== currentDeviceId
  ) {
    if (IS_DEV) {
      console.error("[license] device mismatch detected for local license token.");
    }

    return createLockedSnapshot(state, "invalid", LICENSE_DEVICE_MISMATCH_MESSAGE);
  }

  const offlineActive = !isConnectionOnline();

  if (offlineActive) {
    return createBackendUnavailableSnapshot(state);
  }

  return {
    state,
    status: "active",
    requiresActivation: false,
    message: "",
    offlineActive: false,
    isDevBypass: false,
  };
}

export async function activateLicense(input: LicenseActivationInput) {
  const licenseKey = normalizeLicenseKey(input.licenseKey);

  if (licenseKey.length === 0) {
    throw new Error(LICENSE_REQUIRED_MESSAGE);
  }

  const currentDeviceId = await getCurrentDeviceId();

  try {
    const response = await requestLicenseActivation(
      {
        ...input,
        licenseKey,
      },
      currentDeviceId,
    );
    await persistOwnerControlledAdminModes(response);
    const nextState = await createActiveLicenseState(input, response, currentDeviceId);
    await saveLicenseState(nextState);
    return getLicenseAccessSnapshot();
  } catch (error) {
    const message = resolveApiFailureMessage(error);

    if (message === LICENSE_EXPIRED_MESSAGE) {
      await persistFailedActivationState(input, "expired", currentDeviceId);
    } else if (message === LICENSE_REVOKED_MESSAGE) {
      await persistFailedActivationState(input, "revoked", currentDeviceId);
    } else if (message === LICENSE_SUSPENDED_MESSAGE) {
      await persistFailedActivationState(input, "suspended", currentDeviceId);
    } else if (message === LICENSE_INVALID_MESSAGE) {
      await persistFailedActivationState(input, "invalid", currentDeviceId);
    }

    throw new Error(message);
  }
}
