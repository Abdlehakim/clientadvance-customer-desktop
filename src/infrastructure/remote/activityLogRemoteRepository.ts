/** Remote activity log repository — placeholder. GET /activity-logs */
import type { ActivityLogRepository } from "@/domain/repositories";
import { apiFetch } from "./apiClient";

export const activityLogRemoteRepository: ActivityLogRepository = {
  async getAll() { return apiFetch("/activity-logs"); },
  async create(input) { return apiFetch("/activity-logs", { method: "POST", body: JSON.stringify(input) }); },
};
