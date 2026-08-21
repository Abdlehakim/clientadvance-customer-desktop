import type { User } from "@/domain/types";

let currentUser: User | null = null;
let currentSessionMode: "online" | "offline" | "local" | null = null;

export function setCurrentUserSession(
  user: User | null,
  mode: "online" | "offline" | "local" | null,
) {
  currentUser = user;
  currentSessionMode = user ? mode : null;
}

export function getCurrentUserSession() {
  return currentUser;
}

export function getCurrentSessionMode() {
  return currentSessionMode;
}
