import { getDb, isTauriRuntime, type SqliteRow } from "@/infrastructure/local/sqlite/sqliteClient";
import {
  isMaskedSmtpPasswordValue,
  normalizeSmtpPasswordValue,
} from "./adminSettingsState";
import { KEYS, isBrowser, read } from "./localStorageDatabase";
import { getScopedAppStateKey } from "@/infrastructure/auth/currentCompanyScope";

const SMTP_PASSWORD_STATE_KEY = "smtp_password";

interface AppStateRow extends SqliteRow {
  value: unknown;
}

function usesSqliteSmtpSecretStore() {
  return import.meta.env.VITE_STORAGE_DRIVER === "sqlite" && isTauriRuntime();
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function getStoredSmtpPassword() {
  if (usesSqliteSmtpSecretStore()) {
    const stateKey = getScopedAppStateKey(SMTP_PASSWORD_STATE_KEY);
    const db = await getDb();
    const rows = await db.query<AppStateRow>(
      `
        SELECT value
        FROM app_state
        WHERE key = ?
        LIMIT 1
      `,
      [stateKey],
    );

    return normalizeSmtpPasswordValue(readString(rows[0]?.value));
  }

  return normalizeSmtpPasswordValue(read<string>(KEYS.smtpPassword, ""));
}

export async function persistStoredSmtpPassword(password: string) {
  if (isMaskedSmtpPasswordValue(password)) {
    return;
  }

  const normalizedPassword = normalizeSmtpPasswordValue(password);

  // TODO: move SMTP password to secure Tauri storage before production.
  if (usesSqliteSmtpSecretStore()) {
    const stateKey = getScopedAppStateKey(SMTP_PASSWORD_STATE_KEY);
    const db = await getDb();
    await db.execute(
      `
        INSERT INTO app_state (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = CURRENT_TIMESTAMP
      `,
      [stateKey, normalizedPassword || null],
    );
    return;
  }

  if (!isBrowser()) {
    return;
  }

  if (normalizedPassword) {
    localStorage.setItem(KEYS.smtpPassword, JSON.stringify(normalizedPassword));
    return;
  }

  localStorage.removeItem(KEYS.smtpPassword);
}
