import type { AuthRepository } from "@/domain/repositories";
import type { User } from "@/domain/types";
import { createDefaultAdminUser, isDemoAdminEnabled } from "@/infrastructure/auth/defaultAdmin";
import {
  OFFLINE_LOGIN_UNAVAILABLE_MESSAGE,
  authenticateOfflineCredential,
  initializeOfflineAuthStorage,
} from "@/infrastructure/auth/offlineAuthStorage";
import {
  getCurrentUserSession,
  setCurrentUserSession,
} from "@/infrastructure/auth/currentUserSession";
import {
  clearSqliteAuthSession,
  persistSqliteAuthSession,
} from "@/infrastructure/local/sqlite/sqliteAuthSessionStorage";
import { clearAuthToken } from "@/infrastructure/remote/apiClient";
import { emitChange } from "./localStorageDatabase";
import { activityLogLocalRepository } from "./activityLogLocalRepository";

const DEMO_USERS: User[] = isDemoAdminEnabled() ? [createDefaultAdminUser()] : [];

function persistUser(user: User | null) {
  setCurrentUserSession(user, user ? "local" : null);
  emitChange();
}

export const authLocalRepository: AuthRepository = {
  async login(identifier, password) {
    await initializeOfflineAuthStorage();
    const result = await authenticateOfflineCredential(identifier, password);

    if (result.status === "missing") {
      throw new Error(OFFLINE_LOGIN_UNAVAILABLE_MESSAGE);
    }

    if (result.status === "invalid") {
      return null;
    }

    if (result.status === "inactive") {
      throw new Error("Compte désactivé");
    }

    const user = result.user;

    clearAuthToken();
    persistUser(user);

    await persistSqliteAuthSession({
      token: null,
      user,
      mode: "local",
    });

    activityLogLocalRepository.create({
      user_id: user.id,
      user_name: user.name,
      action_type: "login",
      description: `Connexion de ${user.name}`,
      entity_type: "user",
      entity_id: user.id,
    });

    return user;
  },

  async logout() {
    clearAuthToken();
    persistUser(null);

    try {
      await clearSqliteAuthSession();
    } catch (error) {
      console.error("Failed to clear SQLite auth session.", error);
    }
  },

  getCurrentUser() {
    return getCurrentUserSession();
  },
};

export { DEMO_USERS };
