import type { User } from "@/domain/types";
import { KEYS, emitChange, isBrowser } from "@/infrastructure/local/localStorageDatabase";
import {
  clearAuthToken,
  setAuthToken,
} from "@/infrastructure/remote/apiClient";
import { getDb, isTauriRuntime } from "./sqliteClient";

const AUTH_TOKEN_STATE_KEY = "auth_token";
const AUTH_USER_STATE_KEY = "auth_user";
const AUTH_SESSION_MODE_STATE_KEY = "auth_session_mode";

export type AuthSessionMode = "online" | "offline" | "local";

interface AppStateRow {
  key: unknown;
  value: unknown;
}

function canUseSqliteAuthSessionStorage() {
  return import.meta.env.VITE_STORAGE_DRIVER === "sqlite" && isTauriRuntime();
}

async function writeState(key: string, value: string | null) {
  const db = await getDb();
  await db.execute(
    `
      INSERT INTO app_state (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `,
    [key, value],
  );
}

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}

export async function persistSqliteAuthSession(params: {
  token: string | null;
  user: User | null;
  mode: AuthSessionMode | null;
}) {
  if (!canUseSqliteAuthSessionStorage()) {
    return;
  }

  await writeState(AUTH_TOKEN_STATE_KEY, params.token);
  await writeState(AUTH_USER_STATE_KEY, params.user ? JSON.stringify(params.user) : null);
  await writeState(AUTH_SESSION_MODE_STATE_KEY, params.mode);
}

export async function hydrateSqliteAuthSession() {
  if (!canUseSqliteAuthSessionStorage() || !isBrowser()) {
    return;
  }

  const db = await getDb();
  const rows = await db.query<AppStateRow>(
    `
      SELECT key, value
      FROM app_state
      WHERE key IN (?, ?, ?)
    `,
    [AUTH_TOKEN_STATE_KEY, AUTH_USER_STATE_KEY, AUTH_SESSION_MODE_STATE_KEY],
  );
  const byKey = new Map<string, string | null>();

  for (const row of rows) {
    const key = readString(row.key);

    if (!key) {
      continue;
    }

    byKey.set(key, readString(row.value));
  }

  const token = byKey.get(AUTH_TOKEN_STATE_KEY) ?? null;
  const serializedUser = byKey.get(AUTH_USER_STATE_KEY) ?? null;
  const mode = byKey.get(AUTH_SESSION_MODE_STATE_KEY) ?? null;

  if (token) {
    setAuthToken(token);
  } else {
    clearAuthToken();
  }

  if (serializedUser) {
    localStorage.setItem(KEYS.user, serializedUser);
  } else {
    localStorage.removeItem(KEYS.user);
  }

  if (mode) {
    localStorage.setItem(KEYS.authSessionMode, JSON.stringify(mode));
  } else {
    localStorage.removeItem(KEYS.authSessionMode);
  }

  emitChange();
}

export async function clearSqliteAuthSession() {
  if (!canUseSqliteAuthSessionStorage()) {
    return;
  }

  const db = await getDb();
  await db.execute("DELETE FROM app_state WHERE key IN (?, ?, ?)", [
    AUTH_TOKEN_STATE_KEY,
    AUTH_USER_STATE_KEY,
    AUTH_SESSION_MODE_STATE_KEY,
  ]);
}
