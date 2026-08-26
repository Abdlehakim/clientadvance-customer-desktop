import type { User } from "@/domain/types";

let currentUser: User | null = null;
let currentSessionMode: "online" | "offline" | "local" | null = null;
type CurrentUserSessionListener = () => void;
const currentUserSessionListeners = new Set<CurrentUserSessionListener>();

export function setCurrentUserSession(
  user: User | null,
  mode: "online" | "offline" | "local" | null,
) {
  currentUser = user;
  currentSessionMode = user ? mode : null;

  for (const listener of currentUserSessionListeners) {
    listener();
  }
}

export function getCurrentUserSession() {
  return currentUser;
}

export function getCurrentSessionMode() {
  return currentSessionMode;
}

export function subscribeCurrentUserSession(listener: CurrentUserSessionListener) {
  currentUserSessionListeners.add(listener);

  return () => {
    currentUserSessionListeners.delete(listener);
  };
}
