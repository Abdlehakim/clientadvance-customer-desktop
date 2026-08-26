import {
  getCurrentSessionMode,
  getCurrentUserSession,
} from "./currentUserSession";

export function getCurrentCompanyScope(): string | null {
  const user = getCurrentUserSession();

  if (!user) {
    return null;
  }

  const companyId = user.company_id?.trim();
  if (companyId) {
    return companyId;
  }

  if (getCurrentSessionMode() === "online") {
    return null;
  }

  const userId = user.id?.trim();
  return userId ? `local-user:${userId}` : null;
}

export function requireCurrentCompanyScope(): string {
  const companyScope = getCurrentCompanyScope();

  if (!companyScope) {
    throw new Error("Aucune entreprise active pour cette session.");
  }

  return companyScope;
}

export function getScopedAppStateKey(
  baseKey: string,
  companyScope = requireCurrentCompanyScope(),
): string {
  return `${baseKey}:${companyScope}`;
}

export function getCompanySettingsId(
  companyScope = requireCurrentCompanyScope(),
): string {
  return `settings_${companyScope}`;
}
