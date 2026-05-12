import { isBrowser } from "@/infrastructure/local/localStorageDatabase";

const env = import.meta.env as ImportMetaEnv & {
  VITE_API_BASE_URL?: string;
};
const DEVELOPMENT_API_BASE_URL = "http://localhost:4000/api";
const MISSING_PRODUCTION_API_BASE_URL_MESSAGE =
  "Missing VITE_API_BASE_URL for production build. Set it to the app-server API URL, for example http://102.204.205.77:4101/api.";
const AUTH_TOKEN_KEY = "gestion_facile_auth_token";

let authToken: string | null = isBrowser() ? localStorage.getItem(AUTH_TOKEN_KEY) : null;

function normalizeApiBaseUrl(value: string) {
  const normalized = value.trim();
  return normalized.replace(/\/+$/, "");
}

export function getApiBaseUrl() {
  if (env.VITE_API_BASE_URL?.trim()) {
    return normalizeApiBaseUrl(env.VITE_API_BASE_URL);
  }

  if (import.meta.env.PROD) {
    throw new Error(MISSING_PRODUCTION_API_BASE_URL_MESSAGE);
  }

  return normalizeApiBaseUrl(DEVELOPMENT_API_BASE_URL);
}

export function buildApiUrl(path: string) {
  const normalizedPath = path.trim();

  if (/^https?:\/\//i.test(normalizedPath)) {
    return normalizedPath;
  }

  if (normalizedPath.length === 0) {
    return getApiBaseUrl();
  }

  return `${getApiBaseUrl()}/${normalizedPath.replace(/^\/+/, "")}`;
}

export function getAuthToken() {
  if (!isBrowser()) return authToken;
  authToken = localStorage.getItem(AUTH_TOKEN_KEY);
  return authToken;
}

export function setAuthToken(token: string) {
  authToken = token;
  if (isBrowser()) localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken() {
  authToken = null;
  if (isBrowser()) localStorage.removeItem(AUTH_TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, public payload: unknown, message: string) {
    super(message);
  }
}

export function getApiPayloadMessage(payload: unknown) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof payload.message === "string" &&
    payload.message.trim().length > 0
  ) {
    return payload.message.trim();
  }

  return null;
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getAuthToken();
  const hasJsonBody = init.body !== undefined && !(init.body instanceof FormData);

  if (hasJsonBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  const url = buildApiUrl(path);

  try {
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch (error) {
    throw new ApiError(0, null, error instanceof Error ? error.message : "Serveur indisponible");
  }

  const text = await response.text();
  const payload = text ? safeJson(text) : null;

  if (!response.ok) {
    if (response.status === 401) {
      clearAuthToken();
    }

    throw new ApiError(
      response.status,
      payload,
      getApiErrorMessage(response.status, payload, url),
    );
  }

  return payload as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function getApiErrorMessage(status: number, payload: unknown, path: string) {
  const payloadMessage = getApiPayloadMessage(payload);

  if (payloadMessage) {
    return payloadMessage;
  }

  return `API ${status} sur ${path}`;
}
