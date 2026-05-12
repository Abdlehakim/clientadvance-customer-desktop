import type { ActivityLog, ActivityLogCreateInput } from "@/domain/types";

export interface ActivityLogRepository {
  getAll(): ActivityLog[] | Promise<ActivityLog[]>;
  create(input: ActivityLogCreateInput): ActivityLog | Promise<ActivityLog>;
}
