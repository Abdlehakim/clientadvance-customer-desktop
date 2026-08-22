import type { AuthRepository } from "@/domain/repositories";
import type { User } from "@/domain/types";
import {
  OFFLINE_LOGIN_UNAVAILABLE_MESSAGE,
  authenticateOfflineCredential,
  persistOfflineCredential,
} from "@/infrastructure/auth/offlineAuthStorage";
import {
  getCurrentSessionMode,
  getCurrentUserSession,
  setCurrentUserSession,
} from "@/infrastructure/auth/currentUserSession";
import {
  clearSqliteAuthSession,
  persistSqliteAuthSession,
} from "@/infrastructure/local/sqlite/sqliteAuthSessionStorage";
import {
  emitChange,
} from "@/infrastructure/local/localStorageDatabase";
import { isConnectionOnline } from "@/services/connectionService";
import { persistOwnerControlledAdminModes } from "@/services/ownerControlledModeService";
import { apiFetch, ApiError, clearAuthToken, getAuthToken, setAuthToken } from "./apiClient";

interface RemoteUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: "admin" | "employe";
  is_active?: boolean;
  company_id?: string | null;
  company_name?: string | null;
  company_status?: "active" | "suspended" | "archived" | null;
  account_expires_at?: string | null;
  company_contact_email?: string | null;
  company_contact_phone?: string | null;
  company_admin_name?: string | null;
  company_admin_email?: string | null;
  admin_email?: string | null;
  admin_whatsapp?: string | null;
  server_mode?: "with-server" | "without-server" | null;
  notification_delivery_mode?: "backend" | "desktop-email" | null;
}

interface LoginResponse {
  token: string;
  user: RemoteUser;
}

function toDomainUser(user: RemoteUser): User {
  return {
    ...user,
    password: "",
  };
}

function persistUser(user: User | null, mode: "online" | "offline" | null) {
  setCurrentUserSession(user, mode);
  emitChange();
}

function readStoredUser() {
  return getCurrentUserSession();
}

function readSessionMode() {
  return getCurrentSessionMode();
}

export function isRemoteAuthOfflineSession() {
  return readSessionMode() === "offline" && !getAuthToken();
}

async function persistOfflineLoginArtifacts(
  user: User,
  password: string,
  token: string | null,
  mode: "online" | "offline",
) {
  try {
    await persistOfflineCredential(user, password, {
      lastOnlineLoginAt: mode === "online" ? new Date().toISOString() : undefined,
      syncStatus: mode === "online" ? "synced" : "local",
    });

    await persistSqliteAuthSession({
      token,
      user,
      mode,
    });
  } catch (error) {
    console.error("Offline credential persistence failed.", error);
  }
}

export async function persistRemoteOfflineUserSession(user: User, password: string) {
  clearAuthToken();
  persistUser(user, "offline");
  await persistOfflineLoginArtifacts(user, password, null, "offline");
}

function shouldTryLocalCredentialFallback(error: unknown) {
  if (!(error instanceof ApiError)) {
    return false;
  }

  return error.status === 0 || error.status === 400 || error.status === 401 || error.status >= 500;
}

export const authRemoteRepository: AuthRepository = {
  async login(identifier, password) {
    const normalizedIdentifier = identifier.trim().toLowerCase();
    let remoteError: unknown = null;

    if (isConnectionOnline()) {
      try {
        const response = await apiFetch<LoginResponse>("/auth/login", {
          method: "POST",
          body: JSON.stringify({
            identifier: normalizedIdentifier,
            email: normalizedIdentifier,
            password,
          }),
        });

        setAuthToken(response.token);

        const user = toDomainUser(response.user);

        persistUser(user, "online");
        await persistOwnerControlledAdminModes(response.user);
        await persistOfflineLoginArtifacts(user, password, response.token, "online");

        return user;
      } catch (error) {
        if (!shouldTryLocalCredentialFallback(error)) {
          throw error;
        }

        remoteError = error;
      }
    }

    const localResult = await authenticateOfflineCredential(normalizedIdentifier, password);

    if (localResult.status === "missing") {
      if (remoteError instanceof ApiError && remoteError.status !== 0) {
        throw remoteError;
      }

      throw new Error(OFFLINE_LOGIN_UNAVAILABLE_MESSAGE);
    }

    if (localResult.status === "invalid") {
      return null;
    }

    if (localResult.status === "inactive") {
      throw new Error("Compte désactivé");
    }

    if (localResult.status === "expired") {
      throw new Error("Compte expiré");
    }

    if (
      remoteError instanceof ApiError &&
      remoteError.status !== 0 &&
      localResult.user.role !== "employe"
    ) {
      throw remoteError;
    }

    clearAuthToken();
    persistUser(localResult.user, "offline");
    await persistOfflineLoginArtifacts(localResult.user, password, null, "offline");

    return localResult.user;
  },

  async logout() {
    const token = getAuthToken();

    clearAuthToken();
    persistUser(null, null);

    try {
      await clearSqliteAuthSession();
    } catch (error) {
      console.error("Failed to clear SQLite auth session.", error);
    }

    try {
      if (token) {
        await apiFetch("/auth/logout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      }
    } catch {
      // Ignore logout API failures and always clear local auth state.
    }
  },

  getCurrentUser() {
    if (getAuthToken()) {
      return readStoredUser();
    }

    if (readSessionMode() === "offline") {
      return readStoredUser();
    }

    return null;
  },
};
