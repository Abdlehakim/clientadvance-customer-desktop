import type { AuthRepository } from "@/domain/repositories";
import type { User } from "@/domain/types";
import {
  createDefaultAdminUser,
  isDemoAdminEnabled,
} from "@/infrastructure/auth/defaultAdmin";
import {
  OFFLINE_LOGIN_UNAVAILABLE_MESSAGE,
  authenticateOfflineCredential,
  initializeOfflineAuthStorage,
} from "@/infrastructure/auth/offlineAuthStorage";
import { clearAuthToken } from "@/infrastructure/remote/apiClient";
import { clearSqliteAuthSession, persistSqliteAuthSession } from "@/infrastructure/local/sqlite/sqliteAuthSessionStorage";
import { KEYS, emitChange, isBrowser, read, write } from "./localStorageDatabase";
import { activityLogLocalRepository } from "./activityLogLocalRepository";

const DEMO_USERS: User[] = isDemoAdminEnabled() ? [createDefaultAdminUser()] : [];

function persistUser(user: User | null) {
  if (!isBrowser()) {
    return;
  }

  if (!user) {
    localStorage.removeItem(KEYS.user);
    localStorage.removeItem(KEYS.authSessionMode);
    emitChange();
    return;
  }

  write(KEYS.user, user);
  write(KEYS.authSessionMode, "local");
}

export const authLocalRepository: AuthRepository = {
  async login(email, password) {
    await initializeOfflineAuthStorage();
    const result = await authenticateOfflineCredential(email, password);

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
    void persistSqliteAuthSession({ token: null, user, mode: "local" });
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
  logout() {
    clearAuthToken();
    void clearSqliteAuthSession();
    if (isBrowser()) {
      localStorage.removeItem(KEYS.user);
      localStorage.removeItem(KEYS.authSessionMode);
    }
    emitChange();
  },
  getCurrentUser() {
    return read<User | null>(KEYS.user, null);
  },
};

export { DEMO_USERS };
