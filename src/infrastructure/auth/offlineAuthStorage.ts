import type {
  EmployeeAccount,
  EmployeeAccountCreateInput,
  EmployeeSyncAction,
  EmployeeAccountUpdateInput,
  Role,
  User,
} from "@/domain/types";
import { hydrateSqliteAuthSession } from "@/infrastructure/local/sqlite/sqliteAuthSessionStorage";
import {
  getDb,
  isTauriRuntime,
  type SqliteRow,
} from "@/infrastructure/local/sqlite/sqliteClient";
import {
  KEYS,
  isBrowser,
  read,
  uid,
  write,
} from "@/infrastructure/local/localStorageDatabase";
import {
  createDefaultAdminUser,
  DEFAULT_ADMIN_ACTIVE,
  DEFAULT_ADMIN_PASSWORD,
  isDemoAdminEnabled,
} from "./defaultAdmin";
import {
  getTunisianLocalPhone,
  normalizeStoredTunisianPhone,
} from "@/lib/tunisianPhone";
import {
  generateOfflinePasswordSalt,
  getOfflinePasswordIterations,
  hashOfflinePassword,
} from "./offlinePassword";

type LocalUserSyncStatus = "local" | "synced";
type LocalUserSyncAction = EmployeeSyncAction;

interface OfflineAuthRecord {
  id: string;
  email: string;
  name: string;
  role: Role;
  company_id: string | null;
  company_name: string | null;
  account_expires_at: string | null;
  is_active: boolean;
  offline_enabled: boolean;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  display_password: string;
  phone: string;
  phone_normalized: string;
  seeded: boolean;
  last_online_login_at: string | null;
  created_at: string;
  updated_at: string;
  sync_status: LocalUserSyncStatus;
  pending_sync: boolean;
  sync_action: LocalUserSyncAction;
  deleted_at: string | null;
}

interface OfflineAuthSqliteRow extends SqliteRow {
  id: unknown;
  email: unknown;
  name: unknown;
  role: unknown;
  company_id: unknown;
  company_name: unknown;
  account_expires_at: unknown;
  is_active: unknown;
  offline_enabled: unknown;
  password_hash: unknown;
  password_salt: unknown;
  password_iterations: unknown;
  display_password: unknown;
  phone: unknown;
  phone_normalized: unknown;
  seeded: unknown;
  last_online_login_at: unknown;
  created_at: unknown;
  updated_at: unknown;
  sync_status: unknown;
  pending_sync: unknown;
  sync_action: unknown;
  deleted_at: unknown;
}

type OfflineAuthVerificationResult =
  | { status: "success"; user: User }
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "inactive" }
  | { status: "expired" };

export const OFFLINE_LOGIN_UNAVAILABLE_MESSAGE =
  "Identifiants incorrects ou serveur indisponible.";
const DUPLICATE_EMPLOYEE_EMAIL_MESSAGE = "Cet email est d\u00e9j\u00e0 utilis\u00e9.";
const DUPLICATE_EMPLOYEE_PHONE_MESSAGE =
  "Ce num\u00e9ro de t\u00e9l\u00e9phone est d\u00e9j\u00e0 utilis\u00e9.";

let initializationPromise: Promise<void> | null = null;
let sqliteAuthSessionHydrated = false;
let pendingLocalEmployeeSyncCount = 0;

function usesSqliteCredentialStore() {
  return import.meta.env.VITE_STORAGE_DRIVER === "sqlite" && isTauriRuntime();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizePhoneKey(value: string) {
  const localPhone = getTunisianLocalPhone(value);
  return /^\d{8}$/.test(localPhone) ? localPhone : "";
}

function normalizeNameKey(value: string) {
  return value.trim().toLowerCase();
}

function resolveLoginIdentifier(identifier: string) {
  const trimmedIdentifier = identifier.trim();

  if (trimmedIdentifier.includes("@")) {
    return {
      type: "email" as const,
      value: normalizeEmail(trimmedIdentifier),
    };
  }

  const phoneKey = normalizePhoneKey(trimmedIdentifier);

  if (phoneKey) {
    return {
      type: "phone" as const,
      value: phoneKey,
    };
  }

  return {
    type: "name" as const,
    value: normalizeNameKey(trimmedIdentifier),
  };
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    return value === "1" || value.toLowerCase() === "true";
  }

  return fallback;
}

function readNumber(value: unknown, fallback: number) {
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

function readSyncStatus(value: unknown): LocalUserSyncStatus {
  return value === "synced" ? "synced" : "local";
}

function readSyncAction(value: unknown): LocalUserSyncAction {
  return value === "create" || value === "update" || value === "delete" ? value : "none";
}

function isPendingEmployeeSyncRecord(record: OfflineAuthRecord) {
  return (
    record.role === "employe" &&
    record.pending_sync === true &&
    record.sync_action !== "none"
  );
}

function toSessionUser(record: OfflineAuthRecord): User {
  return {
    id: record.id,
    email: record.email,
    phone: record.phone,
    password: "",
    name: record.name,
    role: record.role,
    company_id: record.company_id,
    company_name: record.company_name,
    account_expires_at: record.account_expires_at,
  };
}

function toEmployeeAccount(record: OfflineAuthRecord): EmployeeAccount {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: record.role,
    is_active: record.is_active,
    created_at: record.created_at,
    updated_at: record.updated_at,
    displayPassword: record.display_password,
    phone: record.phone,
    sync_status: record.sync_status,
    pending_sync: record.pending_sync,
    sync_action: record.sync_action,
    deleted_at: record.deleted_at,
  };
}

function normalizeLocalStorageRecord(
  value: Partial<OfflineAuthRecord> | null | undefined,
): OfflineAuthRecord {
  const now = new Date().toISOString();
  const passwordHash = readString(value?.password_hash);
  const phone = normalizeStoredTunisianPhone(readString(value?.phone));
  const phoneNormalized =
    normalizePhoneKey(readString(value?.phone_normalized)) || normalizePhoneKey(phone);

  return {
    id: readString(value?.id),
    email: normalizeEmail(readString(value?.email)),
    name: readString(value?.name),
    role: readString(value?.role) === "employe" ? "employe" : "admin",
    company_id: readNullableString(value?.company_id),
    company_name: readNullableString(value?.company_name),
    account_expires_at: readNullableString(value?.account_expires_at),
    is_active: readBoolean(value?.is_active, true),
    offline_enabled: readBoolean(value?.offline_enabled, passwordHash.length > 0),
    password_hash: passwordHash,
    password_salt: readString(value?.password_salt),
    password_iterations: readNumber(
      value?.password_iterations,
      getOfflinePasswordIterations(),
    ),
    display_password: readString(value?.display_password),
    phone,
    phone_normalized: phoneNormalized,
    seeded: readBoolean(value?.seeded, false),
    last_online_login_at: readNullableString(value?.last_online_login_at),
    created_at: readString(value?.created_at, now),
    updated_at: readString(value?.updated_at, now),
    sync_status: readSyncStatus(value?.sync_status),
    pending_sync: readBoolean(value?.pending_sync, false),
    sync_action: readSyncAction(value?.sync_action),
    deleted_at: readNullableString(value?.deleted_at),
  };
}

function toOfflineAuthRecord(row: OfflineAuthSqliteRow): OfflineAuthRecord {
  const phone = normalizeStoredTunisianPhone(readString(row.phone));
  const phoneNormalized =
    normalizePhoneKey(readString(row.phone_normalized)) || normalizePhoneKey(phone);

  return {
    id: readString(row.id),
    email: normalizeEmail(readString(row.email)),
    name: readString(row.name),
    role: readString(row.role) === "employe" ? "employe" : "admin",
    company_id: readNullableString(row.company_id),
    company_name: readNullableString(row.company_name),
    account_expires_at: readNullableString(row.account_expires_at),
    is_active: readBoolean(row.is_active, true),
    offline_enabled: readBoolean(row.offline_enabled, true),
    password_hash: readString(row.password_hash),
    password_salt: readString(row.password_salt),
    password_iterations: readNumber(
      row.password_iterations,
      getOfflinePasswordIterations(),
    ),
    display_password: readString(row.display_password),
    phone,
    phone_normalized: phoneNormalized,
    seeded: readBoolean(row.seeded, false),
    last_online_login_at: readNullableString(row.last_online_login_at),
    created_at: readString(row.created_at),
    updated_at: readString(row.updated_at),
    sync_status: readSyncStatus(row.sync_status),
    pending_sync: readBoolean(row.pending_sync, false),
    sync_action: readSyncAction(row.sync_action),
    deleted_at: readNullableString(row.deleted_at),
  };
}

function readLocalStorageRecords() {
  const currentRecords = read<OfflineAuthRecord[]>(KEYS.localUsers, []);

  if (currentRecords.length > 0) {
    const normalizedRecords = currentRecords.map((record) => normalizeLocalStorageRecord(record));
    const shouldPersistNormalization = normalizedRecords.some(
      (record, index) =>
        currentRecords[index]?.phone !== record.phone ||
        currentRecords[index]?.phone_normalized !== record.phone_normalized ||
        currentRecords[index]?.account_expires_at !== record.account_expires_at ||
        currentRecords[index]?.display_password !== record.display_password ||
        currentRecords[index]?.sync_action !== record.sync_action ||
        currentRecords[index]?.deleted_at !== record.deleted_at,
    );

    if (shouldPersistNormalization) {
      writeLocalStorageRecords(normalizedRecords);
    }

    return normalizedRecords;
  }

  const legacyRecords = read<OfflineAuthRecord[]>(KEYS.offlineCredentials, []);

  if (legacyRecords.length === 0) {
    return [];
  }

  const normalizedRecords = legacyRecords.map((record) =>
    normalizeLocalStorageRecord(record),
  );
  writeLocalStorageRecords(normalizedRecords);
  return normalizedRecords;
}

function writeLocalStorageRecords(records: OfflineAuthRecord[]) {
  write(KEYS.localUsers, records);
  write(KEYS.offlineCredentials, records);
  pendingLocalEmployeeSyncCount = records.filter(isPendingEmployeeSyncRecord).length;
}

function findSeededAdminRecord(records: OfflineAuthRecord[]) {
  return records.find((record) => record.seeded && record.role === "admin") ?? null;
}

function removeSeededAdminRecords(records: OfflineAuthRecord[]) {
  return records.filter((record) => !(record.seeded && record.role === "admin"));
}

function areRecordsEquivalent(left: OfflineAuthRecord, right: OfflineAuthRecord) {
  return (
    left.id === right.id &&
    left.email === right.email &&
    left.name === right.name &&
    left.role === right.role &&
    left.company_id === right.company_id &&
    left.company_name === right.company_name &&
    left.account_expires_at === right.account_expires_at &&
    left.is_active === right.is_active &&
    left.offline_enabled === right.offline_enabled &&
    left.password_hash === right.password_hash &&
    left.password_salt === right.password_salt &&
    left.password_iterations === right.password_iterations &&
    left.display_password === right.display_password &&
    left.phone === right.phone &&
    left.phone_normalized === right.phone_normalized &&
    left.seeded === right.seeded &&
    left.last_online_login_at === right.last_online_login_at &&
    left.sync_status === right.sync_status &&
    left.pending_sync === right.pending_sync &&
    left.sync_action === right.sync_action &&
    left.deleted_at === right.deleted_at
  );
}

function createPlaceholderPassword(
  user: Pick<User, "id" | "email">,
  timestamp: string,
) {
  return `offline-disabled:${normalizeEmail(user.email)}:${user.id}:${timestamp}`;
}

async function createRecord(
  user: Pick<User, "id" | "email" | "name" | "role" | "company_id" | "company_name" | "account_expires_at"> & {
    phone?: string | null;
  },
  options: {
    existing?: OfflineAuthRecord | null;
    password?: string;
    seeded?: boolean;
    isActive?: boolean;
    offlineEnabled?: boolean;
    lastOnlineLoginAt?: string | null;
    syncStatus?: LocalUserSyncStatus;
    pendingSync?: boolean;
    displayPassword?: string;
    phone?: string | null;
    createdAt?: string;
    updatedAt?: string;
    syncAction?: LocalUserSyncAction;
    deletedAt?: string | null;
    preserveExistingId?: boolean;
  } = {},
) {
  const salt = options.existing?.password_salt ?? generateOfflinePasswordSalt();
  const iterations =
    options.existing?.password_iterations ?? getOfflinePasswordIterations();
  const now = options.updatedAt ?? new Date().toISOString();
  const createdAt = options.createdAt ?? options.existing?.created_at ?? now;
  const hasPassword =
    typeof options.password === "string" && options.password.trim().length > 0;
  const displayPassword =
    user.role === "employe" && typeof options.password === "string" && options.password.length > 0
      ? options.password
      : options.displayPassword ?? options.existing?.display_password ?? "";
  const phone = normalizeStoredTunisianPhone(
    options.phone ?? user.phone ?? options.existing?.phone ?? "",
  );
  const phoneNormalized = normalizePhoneKey(phone);
  const offlineEnabled =
    options.offlineEnabled ?? (hasPassword ? true : options.existing?.offline_enabled ?? false);

  let passwordHash = options.existing?.password_hash ?? "";

  if (hasPassword) {
    passwordHash = await hashOfflinePassword(options.password!, salt, iterations);
  } else if (passwordHash.trim().length === 0) {
    passwordHash = await hashOfflinePassword(
      createPlaceholderPassword(user, now),
      salt,
      iterations,
    );
  }

  return {
    id:
      options.preserveExistingId === false
        ? user.id
        : options.existing?.id ?? user.id,
    email: normalizeEmail(user.email),
    name: user.name,
    role: user.role,
    company_id: user.company_id ?? options.existing?.company_id ?? null,
    company_name: user.company_name ?? options.existing?.company_name ?? null,
    account_expires_at:
      user.account_expires_at !== undefined
        ? user.account_expires_at
        : options.existing?.account_expires_at ?? null,
    is_active: options.isActive ?? options.existing?.is_active ?? true,
    offline_enabled: offlineEnabled,
    password_hash: passwordHash,
    password_salt: salt,
    password_iterations: iterations,
    display_password: displayPassword,
    phone,
    phone_normalized: phoneNormalized,
    seeded: options.seeded ?? options.existing?.seeded ?? false,
    last_online_login_at:
      options.lastOnlineLoginAt !== undefined
        ? options.lastOnlineLoginAt
        : options.existing?.last_online_login_at ?? null,
    created_at: createdAt,
    updated_at: now,
    sync_status: options.syncStatus ?? options.existing?.sync_status ?? "local",
    pending_sync: options.pendingSync ?? options.existing?.pending_sync ?? false,
    sync_action: options.syncAction ?? options.existing?.sync_action ?? "none",
    deleted_at:
      options.deletedAt !== undefined
        ? options.deletedAt
        : options.existing?.deleted_at ?? null,
  } satisfies OfflineAuthRecord;
}

async function ensureLocalStorageDefaultAdminSeeded() {
  if (!isBrowser()) {
    return;
  }

  const records = readLocalStorageRecords();

  if (!isDemoAdminEnabled()) {
    const nextRecords = removeSeededAdminRecords(records);

    if (nextRecords.length !== records.length) {
      writeLocalStorageRecords(nextRecords);
    }

    return;
  }

  const seededAdminRecord = findSeededAdminRecord(records);

  if (seededAdminRecord) {
    const adminRecord = await createRecord(createDefaultAdminUser(), {
      existing: seededAdminRecord,
      password: DEFAULT_ADMIN_PASSWORD,
      seeded: true,
      isActive: DEFAULT_ADMIN_ACTIVE,
      offlineEnabled: true,
      syncStatus: "local",
      pendingSync: false,
    });

    if (areRecordsEquivalent(seededAdminRecord, adminRecord)) {
      return;
    }

    const nextRecords = records.filter(
      (record) => record.email !== seededAdminRecord.email,
    );
    writeLocalStorageRecords([adminRecord, ...nextRecords]);
    return;
  }

  if (records.length > 0) {
    return;
  }

  const adminRecord = await createRecord(createDefaultAdminUser(), {
    password: DEFAULT_ADMIN_PASSWORD,
    seeded: true,
    isActive: DEFAULT_ADMIN_ACTIVE,
    offlineEnabled: true,
    syncStatus: "local",
    pendingSync: false,
  });

  writeLocalStorageRecords([adminRecord, ...records]);
}

async function getSqliteOfflineAuthRecordByEmail(email: string) {
  const db = await getDb();
  const rows = await db.query<OfflineAuthSqliteRow>(
    `
      SELECT
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
      FROM local_users
      WHERE email = ?
      LIMIT 1
    `,
    [normalizeEmail(email)],
  );

  return rows[0] ? toOfflineAuthRecord(rows[0]) : null;
}

async function getSqliteOfflineAuthRecordById(id: string) {
  const db = await getDb();
  const rows = await db.query<OfflineAuthSqliteRow>(
    `
      SELECT
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
      FROM local_users
      WHERE id = ?
      LIMIT 1
    `,
    [id],
  );

  return rows[0] ? toOfflineAuthRecord(rows[0]) : null;
}

async function listSqliteOfflineAuthRecords() {
  const db = await getDb();
  const rows = await db.query<OfflineAuthSqliteRow>(
    `
      SELECT
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
      FROM local_users
      ORDER BY created_at DESC
    `,
  );

  return rows.map(toOfflineAuthRecord);
}

async function upsertSqliteOfflineAuthRecord(record: OfflineAuthRecord) {
  const db = await getDb();
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
      record.id,
      record.email,
      record.name,
      record.role,
      record.company_id,
      record.company_name,
      record.account_expires_at,
      record.is_active ? 1 : 0,
      record.offline_enabled ? 1 : 0,
      record.password_hash,
      record.password_salt,
      record.password_iterations,
      record.display_password,
      record.phone,
      record.phone_normalized,
      record.seeded ? 1 : 0,
      record.last_online_login_at,
      record.created_at,
      record.updated_at,
      record.sync_status,
      record.pending_sync ? 1 : 0,
      record.sync_action,
      record.deleted_at,
    ],
  );
}

async function ensureSqliteDefaultAdminSeeded() {
  if (!usesSqliteCredentialStore()) {
    return;
  }

  const db = await getDb();

  if (!isDemoAdminEnabled()) {
    await db.execute(
      "DELETE FROM local_users WHERE seeded = 1 AND role = 'admin'",
    );
    return;
  }

  const seededAdminRows = await db.query<OfflineAuthSqliteRow>(
    `
      SELECT
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
      FROM local_users
      WHERE seeded = 1
        AND role = 'admin'
      LIMIT 1
    `,
  );
  const seededAdminRecord = seededAdminRows[0]
    ? toOfflineAuthRecord(seededAdminRows[0])
    : null;

  if (seededAdminRecord) {
    const adminRecord = await createRecord(createDefaultAdminUser(), {
      existing: seededAdminRecord,
      password: DEFAULT_ADMIN_PASSWORD,
      seeded: true,
      isActive: DEFAULT_ADMIN_ACTIVE,
      offlineEnabled: true,
      syncStatus: "local",
      pendingSync: false,
    });

    if (areRecordsEquivalent(seededAdminRecord, adminRecord)) {
      return;
    }

    if (seededAdminRecord.email !== adminRecord.email) {
      await db.execute("DELETE FROM local_users WHERE email = ?", [
        seededAdminRecord.email,
      ]);
    }

    await upsertSqliteOfflineAuthRecord(adminRecord);
    return;
  }

  const adminRows = await db.query<{ admin_count: unknown }>(
    `
      SELECT COUNT(*) AS admin_count
      FROM local_users
      WHERE role = 'admin'
    `,
  );
  const adminCount = readNumber(adminRows[0]?.admin_count, 0);

  if (adminCount > 0) {
    return;
  }

  const adminRecord = await createRecord(createDefaultAdminUser(), {
    password: DEFAULT_ADMIN_PASSWORD,
    seeded: true,
    isActive: DEFAULT_ADMIN_ACTIVE,
    offlineEnabled: true,
    syncStatus: "local",
    pendingSync: false,
  });

  await upsertSqliteOfflineAuthRecord(adminRecord);
}

async function ensureSqliteAuthSchema() {
  if (!usesSqliteCredentialStore()) {
    return;
  }

  const db = await getDb();
  const rows = await db.query<{ name: unknown }>("PRAGMA table_info(local_users)");
  const columns = new Set(rows.map((row) => readString(row.name)));

  const addColumnIfMissing = async (columnName: string, definition: string) => {
    if (columns.has(columnName)) {
      return;
    }

    await db.execute(`ALTER TABLE local_users ADD COLUMN ${columnName} ${definition}`);
    columns.add(columnName);
  };

  await addColumnIfMissing("display_password", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing("phone", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing("phone_normalized", "TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing("account_expires_at", "TEXT");
  await addColumnIfMissing("sync_action", "TEXT NOT NULL DEFAULT 'none'");
  await addColumnIfMissing("deleted_at", "TEXT");
}

async function backfillSqliteAuthPhoneKeys() {
  if (!usesSqliteCredentialStore()) {
    return;
  }

  const db = await getDb();
  const rows = await db.query<{
    id: unknown;
    phone: unknown;
    phone_normalized: unknown;
  }>(
    `
      SELECT id, phone, phone_normalized
      FROM local_users
      WHERE role = 'employe'
    `,
  );

  await Promise.all(
    rows.map(async (row) => {
      const nextPhoneNormalized = normalizePhoneKey(readString(row.phone));

      if (readString(row.phone_normalized) === nextPhoneNormalized) {
        return;
      }

      await db.execute(
        `
          UPDATE local_users
          SET phone_normalized = ?
          WHERE id = ?
        `,
        [nextPhoneNormalized, readString(row.id)],
      );
    }),
  );
}

async function getLocalStorageOfflineAuthRecordByEmail(email: string) {
  return (
    readLocalStorageRecords().find(
      (record) => record.email === normalizeEmail(email),
    ) ?? null
  );
}

async function getLocalStorageOfflineAuthRecordByPhone(phone: string) {
  const phoneKey = normalizePhoneKey(phone);

  if (!phoneKey) {
    return null;
  }

  return (
    readLocalStorageRecords().find(
      (record) =>
        !record.deleted_at && record.phone_normalized === phoneKey,
    ) ?? null
  );
}

async function getLocalStorageOfflineAuthRecordById(id: string) {
  return readLocalStorageRecords().find((record) => record.id === id) ?? null;
}

async function listLocalStorageOfflineAuthRecords() {
  return readLocalStorageRecords();
}

async function upsertLocalStorageOfflineAuthRecord(record: OfflineAuthRecord) {
  const records = readLocalStorageRecords().filter(
    (currentRecord) =>
      currentRecord.email !== record.email && currentRecord.id !== record.id,
  );
  writeLocalStorageRecords([record, ...records]);
}

async function deleteOfflineAuthRecordById(id: string) {
  if (usesSqliteCredentialStore()) {
    const db = await getDb();
    await db.execute("DELETE FROM local_users WHERE id = ? AND role = 'employe'", [id]);
    await refreshPendingLocalEmployeeSyncCount();
    return;
  }

  const records = readLocalStorageRecords().filter(
    (record) => !(record.id === id && record.role === "employe"),
  );
  writeLocalStorageRecords(records);
}

async function getOfflineAuthRecordByEmail(email: string) {
  if (usesSqliteCredentialStore()) {
    return getSqliteOfflineAuthRecordByEmail(email);
  }

  return getLocalStorageOfflineAuthRecordByEmail(email);
}

async function getOfflineAuthRecordByPhone(phone: string) {
  if (usesSqliteCredentialStore()) {
    const phoneKey = normalizePhoneKey(phone);

    if (!phoneKey) {
      return null;
    }

    return (
      (await listSqliteOfflineAuthRecords()).find(
        (record) =>
          !record.deleted_at && record.phone_normalized === phoneKey,
      ) ?? null
    );
  }

  return getLocalStorageOfflineAuthRecordByPhone(phone);
}

async function getOfflineAuthRecordByName(name: string) {
  const nameKey = normalizeNameKey(name);

  if (!nameKey) {
    return null;
  }

  return (
    (await listOfflineAuthRecords()).find(
      (record) =>
        record.role === "employe" && !record.deleted_at && normalizeNameKey(record.name) === nameKey,
    ) ?? null
  );
}

async function getOfflineAuthRecordByIdentifier(identifier: string) {
  const resolvedIdentifier = resolveLoginIdentifier(identifier);

  if (resolvedIdentifier.type === "email") {
    return getOfflineAuthRecordByEmail(resolvedIdentifier.value);
  }

  if (resolvedIdentifier.type === "phone") {
    return getOfflineAuthRecordByPhone(resolvedIdentifier.value);
  }

  return getOfflineAuthRecordByName(resolvedIdentifier.value);
}

async function getOfflineAuthRecordById(id: string) {
  if (usesSqliteCredentialStore()) {
    return getSqliteOfflineAuthRecordById(id);
  }

  return getLocalStorageOfflineAuthRecordById(id);
}

async function listOfflineAuthRecords() {
  if (usesSqliteCredentialStore()) {
    return listSqliteOfflineAuthRecords();
  }

  return listLocalStorageOfflineAuthRecords();
}

async function refreshPendingLocalEmployeeSyncCount() {
  pendingLocalEmployeeSyncCount = (await listOfflineAuthRecords()).filter(
    isPendingEmployeeSyncRecord,
  ).length;
}

async function upsertOfflineAuthRecord(record: OfflineAuthRecord) {
  if (usesSqliteCredentialStore()) {
    await upsertSqliteOfflineAuthRecord(record);
    await refreshPendingLocalEmployeeSyncCount();
    return;
  }

  await upsertLocalStorageOfflineAuthRecord(record);
}

async function assertEmployeePhoneAvailable(phone: string, excludedId?: string) {
  const phoneKey = normalizePhoneKey(phone);

  if (!phoneKey) {
    return;
  }

  const duplicate = (await listOfflineAuthRecords()).find(
    (record) =>
      record.role === "employe" &&
      !record.deleted_at &&
      record.id !== excludedId &&
      record.phone_normalized === phoneKey,
  );

  if (duplicate) {
    throw new Error(DUPLICATE_EMPLOYEE_PHONE_MESSAGE);
  }
}

async function verifyOfflineAuthRecord(
  record: OfflineAuthRecord | null,
  password: string,
): Promise<OfflineAuthVerificationResult> {
  if (!record) {
    return { status: "missing" };
  }

  if (record.deleted_at) {
    return { status: "missing" };
  }

  if (!record.is_active) {
    return { status: "inactive" };
  }

  if (record.company_id && record.account_expires_at) {
    const accountExpiresAt = Date.parse(record.account_expires_at);

    if (Number.isFinite(accountExpiresAt) && accountExpiresAt <= Date.now()) {
      return { status: "expired" };
    }
  }

  if (!record.offline_enabled || record.password_hash.trim().length === 0) {
    return { status: "missing" };
  }

  const hashedPassword = await hashOfflinePassword(
    password,
    record.password_salt,
    record.password_iterations,
  );

  if (hashedPassword !== record.password_hash) {
    return { status: "invalid" };
  }

  return {
    status: "success",
    user: toSessionUser(record),
  };
}

export async function initializeOfflineAuthStorage() {
  if (!isBrowser()) {
    return;
  }

  initializationPromise ??= (async () => {
    if (usesSqliteCredentialStore()) {
      await ensureSqliteAuthSchema();
      await ensureSqliteDefaultAdminSeeded();
      await backfillSqliteAuthPhoneKeys();

      if (!sqliteAuthSessionHydrated) {
        await hydrateSqliteAuthSession();
        sqliteAuthSessionHydrated = true;
      }

      await refreshPendingLocalEmployeeSyncCount();
      return;
    }

    await ensureLocalStorageDefaultAdminSeeded();
    await refreshPendingLocalEmployeeSyncCount();
  })().finally(() => {
    initializationPromise = null;
  });

  return initializationPromise;
}

export async function persistOfflineCredential(
  user: User,
  password: string,
  options: {
    lastOnlineLoginAt?: string | null;
    syncStatus?: LocalUserSyncStatus;
  } = {},
) {
  await initializeOfflineAuthStorage();

  const existing = await getOfflineAuthRecordByEmail(user.email);
  const record = await createRecord(user, {
    existing,
    password,
    offlineEnabled: true,
    lastOnlineLoginAt:
      options.lastOnlineLoginAt !== undefined
        ? options.lastOnlineLoginAt
        : existing?.last_online_login_at,
    syncStatus: options.syncStatus ?? existing?.sync_status ?? "synced",
    pendingSync: false,
  });
  await upsertOfflineAuthRecord(record);
}

export async function authenticateOfflineCredential(
  identifier: string,
  password: string,
): Promise<OfflineAuthVerificationResult> {
  await initializeOfflineAuthStorage();
  const resolvedIdentifier = resolveLoginIdentifier(identifier);
  const record = await getOfflineAuthRecordByIdentifier(identifier);

  if (record?.role === "admin") {
    const hasStoredPhone =
      normalizePhoneKey(record.phone_normalized || record.phone).length > 0;

    if (hasStoredPhone && resolvedIdentifier.type !== "phone") {
      return { status: "invalid" };
    }
  }

  return verifyOfflineAuthRecord(record, password);
}

export async function hasOfflineCredential(email: string) {
  await initializeOfflineAuthStorage();
  return (await getOfflineAuthRecordByEmail(email)) !== null;
}

export async function listLocalEmployeeAccounts(): Promise<EmployeeAccount[]> {
  await initializeOfflineAuthStorage();
  const records = await listOfflineAuthRecords();

  return records
    .filter((record) => record.role === "employe" && !record.deleted_at)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .map(toEmployeeAccount);
}

export async function resetLocalEmployeeAccounts() {
  await initializeOfflineAuthStorage();

  if (usesSqliteCredentialStore()) {
    const db = await getDb();
    await db.execute("DELETE FROM local_users WHERE role = 'employe'");
    await refreshPendingLocalEmployeeSyncCount();
  }

  if (isBrowser()) {
    const records = readLocalStorageRecords().filter((record) => record.role !== "employe");
    writeLocalStorageRecords(records);
  }
}

export async function deleteLocalEmployeeAccount(id: string) {
  await initializeOfflineAuthStorage();
  const existing = await getOfflineAuthRecordById(id);

  if (!existing || existing.role !== "employe") {
    throw new Error("Utilisateur local introuvable");
  }

  await deleteOfflineAuthRecordById(id);
}

function isLocalOnlyEmployeeRecord(record: OfflineAuthRecord) {
  return record.sync_action === "create" || !record.id.startsWith("usr_");
}

export async function markLocalEmployeeAccountDeleted(id: string) {
  await initializeOfflineAuthStorage();
  const existing = await getOfflineAuthRecordById(id);

  if (!existing || existing.role !== "employe") {
    throw new Error("Utilisateur local introuvable");
  }

  if (isLocalOnlyEmployeeRecord(existing)) {
    await deleteOfflineAuthRecordById(id);
    return { queued: false as const };
  }

  const deletedAt = new Date().toISOString();
  const record = await createRecord(
    {
      id: existing.id,
      email: existing.email,
      name: existing.name,
      phone: existing.phone,
      role: existing.role,
      company_id: existing.company_id,
      company_name: existing.company_name,
    },
    {
      existing,
      isActive: false,
      offlineEnabled: false,
      syncStatus: "local",
      pendingSync: true,
      syncAction: "delete",
      deletedAt,
      updatedAt: deletedAt,
    },
  );

  await upsertOfflineAuthRecord(record);
  return { queued: true as const };
}

export async function createLocalEmployeeAccount(
  input: EmployeeAccountCreateInput,
  options: {
    id?: string;
    is_active?: boolean;
    offline_enabled?: boolean;
    last_online_login_at?: string | null;
    sync_status?: LocalUserSyncStatus;
    pending_sync?: boolean;
    sync_action?: LocalUserSyncAction;
    created_at?: string;
    updated_at?: string;
  } = {},
): Promise<EmployeeAccount> {
  await initializeOfflineAuthStorage();

  const normalizedEmail = normalizeEmail(input.email);
  const normalizedPhone = normalizeStoredTunisianPhone(input.phone ?? "");
  const existing = await getOfflineAuthRecordByEmail(normalizedEmail);

  if (existing) {
    throw new Error(DUPLICATE_EMPLOYEE_EMAIL_MESSAGE);
  }

  await assertEmployeePhoneAvailable(normalizedPhone);

  const now = options.created_at ?? new Date().toISOString();
  const employee: EmployeeAccount = {
    id: options.id ?? uid(),
    name: input.name.trim(),
    email: normalizedEmail,
    phone: normalizedPhone,
    role: "employe",
    is_active: options.is_active ?? true,
    created_at: now,
    updated_at: options.updated_at ?? now,
  };

  return upsertLocalEmployeeAccount(employee, {
    password: input.password,
    offline_enabled: options.offline_enabled ?? true,
    last_online_login_at: options.last_online_login_at ?? null,
    sync_status: options.sync_status ?? "local",
    pending_sync: options.pending_sync ?? false,
    sync_action:
      options.sync_action ??
      (options.pending_sync ? "create" : "none"),
  });
}

export async function upsertLocalEmployeeAccount(
  employee: EmployeeAccount,
  options: {
    password?: string;
    offline_enabled?: boolean;
    last_online_login_at?: string | null;
    sync_status?: LocalUserSyncStatus;
    pending_sync?: boolean;
    sync_action?: LocalUserSyncAction;
    deleted_at?: string | null;
    preserve_existing_id?: boolean;
  } = {},
): Promise<EmployeeAccount> {
  await initializeOfflineAuthStorage();

  const existing =
    (await getOfflineAuthRecordById(employee.id)) ??
    (await getOfflineAuthRecordByEmail(employee.email));
  const record = await createRecord(
    {
      id: employee.id,
      email: employee.email,
      name: employee.name,
      phone: employee.phone,
      role: employee.role,
    },
    {
      existing,
      password: options.password,
      isActive: employee.is_active,
      offlineEnabled: options.offline_enabled,
      lastOnlineLoginAt: options.last_online_login_at,
      syncStatus: options.sync_status,
      pendingSync: options.pending_sync,
      syncAction: options.sync_action,
      deletedAt: options.deleted_at,
      preserveExistingId: options.preserve_existing_id,
      createdAt: employee.created_at,
      updatedAt: employee.updated_at,
    },
  );

  await upsertOfflineAuthRecord(record);
  return toEmployeeAccount(record);
}

export async function updateLocalEmployeeAccount(
  id: string,
  patch: EmployeeAccountUpdateInput,
  options: {
    offline_enabled?: boolean;
    last_online_login_at?: string | null;
    sync_status?: LocalUserSyncStatus;
    pending_sync?: boolean;
    sync_action?: LocalUserSyncAction;
    updated_at?: string;
  } = {},
): Promise<EmployeeAccount> {
  await initializeOfflineAuthStorage();
  const existing = await getOfflineAuthRecordById(id);

  if (!existing || existing.role !== "employe") {
    throw new Error("Utilisateur local introuvable");
  }

  const normalizedPhone =
    patch.phone !== undefined
      ? normalizeStoredTunisianPhone(patch.phone)
      : existing.phone;

  await assertEmployeePhoneAvailable(normalizedPhone, existing.id);

  return upsertLocalEmployeeAccount(
    {
      id: existing.id,
      name: patch.name?.trim() || existing.name,
      email: existing.email,
      phone: normalizedPhone,
      role: existing.role,
      is_active: patch.is_active ?? existing.is_active,
      created_at: existing.created_at,
      updated_at: options.updated_at ?? new Date().toISOString(),
    },
    {
      password: patch.password,
      offline_enabled:
        options.offline_enabled ?? (patch.password !== undefined ? true : existing.offline_enabled),
      last_online_login_at:
        options.last_online_login_at !== undefined
          ? options.last_online_login_at
          : existing.last_online_login_at,
      sync_status: options.sync_status ?? existing.sync_status,
      pending_sync: options.pending_sync ?? existing.pending_sync,
      sync_action:
        options.sync_action ??
        (options.pending_sync
          ? existing.sync_action === "create"
            ? "create"
            : "update"
          : existing.sync_action),
    },
  );
}

export function getPendingLocalEmployeeAccountSyncCount() {
  if (!usesSqliteCredentialStore()) {
    pendingLocalEmployeeSyncCount = readLocalStorageRecords().filter(
      isPendingEmployeeSyncRecord,
    ).length;
  }

  return pendingLocalEmployeeSyncCount;
}

export async function listPendingLocalEmployeeAccountSyncRecords() {
  await initializeOfflineAuthStorage();
  return (await listOfflineAuthRecords())
    .filter(isPendingEmployeeSyncRecord)
    .sort((left, right) => left.updated_at.localeCompare(right.updated_at))
    .map(toEmployeeAccount);
}

export async function markLocalEmployeeAccountSynced(
  localId: string,
  employee: EmployeeAccount,
  options: { password?: string } = {},
) {
  await initializeOfflineAuthStorage();
  const existing =
    (await getOfflineAuthRecordById(localId)) ??
    (await getOfflineAuthRecordByEmail(employee.email));

  const record = await createRecord(
    {
      id: employee.id,
      email: employee.email,
      name: employee.name,
      phone: employee.phone,
      role: employee.role,
      company_id: existing?.company_id ?? null,
      company_name: existing?.company_name ?? null,
    },
    {
      existing,
      password: options.password,
      displayPassword: options.password ?? existing?.display_password ?? "",
      isActive: employee.is_active,
      offlineEnabled: true,
      syncStatus: "synced",
      pendingSync: false,
      syncAction: "none",
      deletedAt: null,
      preserveExistingId: false,
      createdAt: employee.created_at,
      updatedAt: employee.updated_at,
    },
  );

  await upsertOfflineAuthRecord(record);
  return toEmployeeAccount(record);
}
