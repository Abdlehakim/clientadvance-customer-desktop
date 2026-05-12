import type { ActivityLogRepository } from "@/domain/repositories";
import type { ActivityLog } from "@/domain/types";
import { KEYS, read, uid, write } from "./localStorageDatabase";

export const activityLogLocalRepository: ActivityLogRepository = {
  getAll() {
    return read<ActivityLog[]>(KEYS.logs, []);
  },
  create(input) {
    const log: ActivityLog = {
      ...input,
      id: uid(),
      created_at: new Date().toISOString(),
      pending_sync: true,
      sync_status: "pending",
    };

    write(KEYS.logs, [log, ...read<ActivityLog[]>(KEYS.logs, [])]);
    return log;
  },
};
