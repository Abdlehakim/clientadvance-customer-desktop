import {
  KEYS,
  emitChange,
  isBrowser,
  readBoolean,
  write,
} from "@/infrastructure/local/localStorageDatabase";

const enableOfflineTestToggle = import.meta.env.VITE_ENABLE_OFFLINE_TEST_TOGGLE === "true";
const API_UNREACHABLE_RETRY_MS = 30_000;

let initialized = false;
let apiReachability: "unknown" | "reachable" | "unreachable" = "unknown";
let lastApiFailureAt = 0;
let retryEmitTimer: ReturnType<typeof setTimeout> | null = null;

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

function clearRetryEmitTimer() {
  if (retryEmitTimer === null) {
    return;
  }

  clearTimeout(retryEmitTimer);
  retryEmitTimer = null;
}

function scheduleRetryEmit() {
  if (!isBrowser() || retryEmitTimer !== null) {
    return;
  }

  retryEmitTimer = setTimeout(() => {
    retryEmitTimer = null;
    emitChange();
  }, API_UNREACHABLE_RETRY_MS + 50);
}

function getConnectionOnlineSnapshot() {
  const override = readOnlineOverride();

  if (override !== null) {
    return override;
  }

  if (!getNavigatorOnlineStatus()) {
    return false;
  }

  if (
    apiReachability === "unreachable" &&
    Date.now() - lastApiFailureAt < API_UNREACHABLE_RETRY_MS
  ) {
    return false;
  }

  return true;
}

function notifyIfOnlineStatusChanged(previousOnline: boolean) {
  if (previousOnline !== getConnectionOnlineSnapshot()) {
    emitChange();
  }
}

export function initializeConnectionStatus() {
  if (!isBrowser() || initialized) {
    return;
  }

  const notifyChange = () => {
    apiReachability = "unknown";
    lastApiFailureAt = 0;
    clearRetryEmitTimer();
    emitChange();
  };

  window.addEventListener("online", notifyChange);
  window.addEventListener("offline", notifyChange);

  initialized = true;
}

export function isConnectionOnline() {
  return getConnectionOnlineSnapshot();
}

export function setConnectionTestOverride(value: boolean) {
  if (!enableOfflineTestToggle) {
    return;
  }

  write(KEYS.onlineOverride, value);
}

export function recordApiConnectionSuccess() {
  const previousOnline = getConnectionOnlineSnapshot();

  apiReachability = "reachable";
  lastApiFailureAt = 0;
  clearRetryEmitTimer();
  notifyIfOnlineStatusChanged(previousOnline);
}

export function recordApiConnectionFailure() {
  const previousOnline = getConnectionOnlineSnapshot();

  apiReachability = "unreachable";
  lastApiFailureAt = Date.now();
  scheduleRetryEmit();
  notifyIfOnlineStatusChanged(previousOnline);
}
