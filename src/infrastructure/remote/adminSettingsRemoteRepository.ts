/** Remote admin settings repository — placeholder. GET/PUT /admin-settings */
import type { AdminSettingsRepository } from "@/domain/repositories";
import { apiFetch } from "./apiClient";

export const adminSettingsRemoteRepository: AdminSettingsRepository = {
  async get() { return apiFetch("/admin-settings"); },
  async update(patch) { await apiFetch("/admin-settings", { method: "PUT", body: JSON.stringify(patch) }); },
};
