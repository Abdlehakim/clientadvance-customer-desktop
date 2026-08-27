export type SqliteParam = string | number | boolean | null;
export type SqliteRow = Record<string, unknown>;

export interface SqliteStatement {
  sql: string;
  params?: SqliteParam[];
}

export interface SqliteDatabaseInfo {
  path: string;
  directory: string;
  isCustom: boolean;
}

export interface ChangeDatabaseLocationResult {
  location: SqliteDatabaseInfo;
  replacedExisting: boolean;
  requiresConfirmation: boolean;
}

export interface SqliteDatabaseBackupInfo {
  path: string;
  directory: string;
}

export interface SqliteExecuteResult {
  rowsAffected: number;
  lastInsertRowid: number;
}

export interface SqliteDatabaseClient {
  execute(sql: string, params?: SqliteParam[]): Promise<SqliteExecuteResult>;
  query<T extends SqliteRow = SqliteRow>(sql: string, params?: SqliteParam[]): Promise<T[]>;
  transaction(statements: SqliteStatement[]): Promise<SqliteExecuteResult[]>;
}

interface TauriInvoke {
  <T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

declare global {
  interface Window {
    __TAURI__?: {
      invoke?: TauriInvoke;
      core?: {
        invoke?: TauriInvoke;
      };
    };
    __TAURI_INTERNALS__?: {
      invoke?: TauriInvoke;
    };
  }
}

let sqliteInitPromise: Promise<SqliteDatabaseInfo> | null = null;

function getTauriInvoke() {
  if (typeof window === "undefined") {
    return null;
  }

  const invoke =
    window.__TAURI__?.core?.invoke ??
    window.__TAURI__?.invoke ??
    window.__TAURI_INTERNALS__?.invoke;

  return typeof invoke === "function" ? invoke : null;
}

export function isTauriRuntime() {
  return getTauriInvoke() !== null;
}

function getInvoke() {
  const invoke = getTauriInvoke();

  if (!invoke) {
    throw new Error("Tauri runtime not available. SQLite storage requires the desktop app.");
  }

  return invoke;
}

function extractInvokeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  if (typeof error === "object" && error !== null) {
    const maybeMessage = Reflect.get(error, "message");

    if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) {
      return maybeMessage;
    }

    const maybeError = Reflect.get(error, "error");

    if (typeof maybeError === "string" && maybeError.trim().length > 0) {
      return maybeError;
    }

    return "Tauri command failed.";
  }

  return "Tauri command failed.";
}

export async function invokeTauriCommand<T>(command: string, args?: Record<string, unknown>) {
  if (!isTauriRuntime()) {
    throw new Error("Tauri runtime not available.");
  }

  try {
    return await getInvoke()<T>(command, args);
  } catch (error) {
    throw new Error(extractInvokeErrorMessage(error));
  }
}

async function invokeSqliteCommand<T>(command: string, args?: Record<string, unknown>) {
  await initializeSqliteDatabase();
  return invokeTauriCommand<T>(command, args);
}

export async function initializeSqliteDatabase() {
  if (!isTauriRuntime()) {
    throw new Error("SQLite initialization is only available inside the Tauri desktop runtime.");
  }

  sqliteInitPromise ??= getInvoke()<SqliteDatabaseInfo>("sqlite_init");
  return sqliteInitPromise;
}

export function resetSqliteInitialization() {
  sqliteInitPromise = null;
}

export async function getDatabaseLocation() {
  return invokeTauriCommand<SqliteDatabaseInfo>("get_database_location");
}

export async function openDatabaseLocation() {
  return invokeTauriCommand<SqliteDatabaseInfo>("open_database_location");
}

export async function chooseDatabaseFolder() {
  return invokeTauriCommand<string | null>("choose_database_folder");
}

export async function getOrCreateDeviceId() {
  return invokeTauriCommand<string>("get_or_create_device_id");
}

export async function changeDatabaseLocation(
  folderPath: string,
  replaceExisting = false,
) {
  return invokeTauriCommand<ChangeDatabaseLocationResult>("change_database_location", {
    request: { folderPath, replaceExisting },
  });
}

export async function backupDatabase() {
  return invokeTauriCommand<SqliteDatabaseBackupInfo>("backup_database");
}

export async function sqliteExecute(sql: string, params: SqliteParam[] = []) {
  return invokeSqliteCommand<SqliteExecuteResult>("sqlite_execute", {
    statement: { sql, params },
  });
}

export async function sqliteQuery<T extends SqliteRow = SqliteRow>(
  sql: string,
  params: SqliteParam[] = [],
) {
  return invokeSqliteCommand<T[]>("sqlite_query", {
    statement: { sql, params },
  });
}

export async function sqliteTransaction(statements: SqliteStatement[]) {
  return invokeSqliteCommand<SqliteExecuteResult[]>("sqlite_transaction", {
    statements: statements.map((statement) => ({
      sql: statement.sql,
      params: statement.params ?? [],
    })),
  });
}

export async function getDb(): Promise<SqliteDatabaseClient> {
  await initializeSqliteDatabase();

  return {
    execute: sqliteExecute,
    query: sqliteQuery,
    transaction: sqliteTransaction,
  };
}
