import {
  KEYS,
  emitChange,
  isBrowser,
  readBoolean,
  write,
} from "@/infrastructure/local/localStorageDatabase";

const enableOfflineTestToggle = import.meta.env.VITE_ENABLE_OFFLINE_TEST_TOGGLE === "true";

let initialized = false;

function readOnlineOverride(): boolean | null {
  if (!enableOfflineTestToggle || !isBrowser()) {
    return null;
  }

  if (localStorage.getItem(KEYS.onlineOverride) === null) {
    return null;
  }

  return readBoolean(KEYS.onlineOverride, true);
}

function getNavigatorOnlineStatus() {
  if (!isBrowser() || typeof navigator === "undefined") {
    return true;
  }

  return navigator.onLine;
}

export function initializeConnectionStatus() {
  if (!isBrowser() || initialized) {
    return;
  }

  const notifyChange = () => emitChange();

  window.addEventListener("online", notifyChange);
  window.addEventListener("offline", notifyChange);

  initialized = true;
}

export function isConnectionOnline() {
  return readOnlineOverride() ?? getNavigatorOnlineStatus();
}

export function setConnectionTestOverride(value: boolean) {
  if (!enableOfflineTestToggle) {
    return;
  }

  write(KEYS.onlineOverride, value);
}
