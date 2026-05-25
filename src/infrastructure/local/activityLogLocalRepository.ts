import type { ActivityLogRepository } from "@/domain/repositories";
import type { ActivityLog } from "@/domain/types";
import { KEYS, read, uid, write } from "./localStorageDatabase";
import {
  ACTIVITY_LOG_RETENTION_DAYS,
  filterActivityLogsByRetention,
} from "@/services/activityLogRetention";

export function cleanupOldActivityLogs(retentionDays = ACTIVITY_LOG_RETENTION_DAYS) {
  const logs = read<ActivityLog[]>(KEYS.logs, []);
  const retainedLogs = filterActivityLogsByRetention(logs, retentionDays);

  if (retainedLogs.length !== logs.length) {
    write(KEYS.logs, retainedLogs);
  }

  return logs.length - retainedLogs.length;
}

export const activityLogLocalRepository: ActivityLogRepository = {
  getAll() {
    return filterActivityLogsByRetention(read<ActivityLog[]>(KEYS.logs, []));
  },
  create(input) {
    const log: ActivityLog = {
      ...input,
      id: uid(),
      created_at: new Date().toISOString(),
      pending_sync: true,
      sync_status: "pending",
    };

    write(KEYS.logs, [
      log,
      ...filterActivityLogsByRetention(read<ActivityLog[]>(KEYS.logs, [])),
    ]);
    return log;
  },
};
