import type { Role, User } from "@/domain/types";

const env = import.meta.env as ImportMetaEnv & {
  DEFAULT_ADMIN_EMAIL?: string;
  DEFAULT_ADMIN_PASSWORD?: string;
  DEFAULT_ADMIN_NAME?: string;
  VITE_DEMO_ADMIN_ENABLED?: string;
};

export function isDemoAdminEnabled() {
  return (
    env.VITE_DEMO_ADMIN_ENABLED === "true" &&
    typeof env.DEFAULT_ADMIN_EMAIL === "string" &&
    env.DEFAULT_ADMIN_EMAIL.trim().length > 0 &&
    typeof env.DEFAULT_ADMIN_PASSWORD === "string" &&
    env.DEFAULT_ADMIN_PASSWORD.trim().length > 0
  );
}

// Local fallback admin creation is disabled unless explicit credentials are
// provided through environment variables.
export const DEFAULT_ADMIN_EMAIL = (env.DEFAULT_ADMIN_EMAIL ?? "").trim().toLowerCase();
export const DEFAULT_ADMIN_PASSWORD = env.DEFAULT_ADMIN_PASSWORD ?? "";
export const DEFAULT_ADMIN_NAME = (
  env.DEFAULT_ADMIN_NAME ?? "Admin"
).trim();

export const DEFAULT_ADMIN_ID = "local_admin";
export const DEFAULT_ADMIN_ROLE: Role = "admin";
export const DEFAULT_ADMIN_ACTIVE = true;

export function createDefaultAdminUser(): User {
  return {
    id: DEFAULT_ADMIN_ID,
    email: DEFAULT_ADMIN_EMAIL,
    password: "",
    name: DEFAULT_ADMIN_NAME,
    role: DEFAULT_ADMIN_ROLE,
    company_id: null,
    company_name: null,
  };
}
