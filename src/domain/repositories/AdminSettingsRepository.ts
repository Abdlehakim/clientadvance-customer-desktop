import type { AdminSettings, AdminSettingsUpdateInput } from "@/domain/types";

export interface AdminSettingsRepository {
  get(): AdminSettings | Promise<AdminSettings>;
  update(patch: AdminSettingsUpdateInput): void | Promise<void>;
}
