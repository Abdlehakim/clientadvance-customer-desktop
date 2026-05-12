import type { AdminSettingsRepository } from "@/domain/repositories";
import type { AdminSettings } from "@/domain/types";
import { authLocalRepository } from "./authLocalRepository";
import {
  applyAdminSettingsUpdate,
  createAdminSettingsFallback,
  normalizeSmtpPasswordValue,
  normalizeAdminSettings,
} from "./adminSettingsState";
import { activityLogLocalRepository } from "./activityLogLocalRepository";
import { KEYS, read, write } from "./localStorageDatabase";
import { getStoredSmtpPassword, persistStoredSmtpPassword } from "./smtpPasswordStorage";

const fallback = (): AdminSettings => createAdminSettingsFallback();

export const adminSettingsLocalRepository: AdminSettingsRepository = {
  get() {
    return normalizeAdminSettings(read<AdminSettings>(KEYS.settings, fallback()));
  },
  async update(patch) {
    const user = authLocalRepository.getCurrentUser();

    if (user?.role !== "admin") {
      throw new Error("Accès refusé. Cette section est réservée à l’administrateur.");
    }

    const current = normalizeAdminSettings(read<AdminSettings>(KEYS.settings, fallback()));
    const updatedAt = new Date().toISOString();
    const nextPassword = normalizeSmtpPasswordValue(patch.smtp_password);
    const hasStoredPassword = (await getStoredSmtpPassword()).length > 0;
    const next = applyAdminSettingsUpdate(current, patch, {
      updatedAt,
      updatedBy: user?.name ?? current.updated_by ?? "",
      smtpPasswordConfigured: nextPassword
        ? true
        : current.smtp_password_configured || hasStoredPassword,
    });

    if (nextPassword) {
      await persistStoredSmtpPassword(nextPassword);
    }

    write(KEYS.settings, next);
    activityLogLocalRepository.create({
      user_id: user?.id ?? "",
      user_name: user?.name ?? "—",
      action_type: "settings_update",
      description: "Mise à jour des paramètres administrateur",
      entity_type: "settings",
      entity_id: next.id,
    });
  },
};
