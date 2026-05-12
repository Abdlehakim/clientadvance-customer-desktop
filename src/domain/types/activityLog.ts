import type { SyncStatus } from "./sync";

export interface ActivityLog {
  id: string;
  user_id: string;
  user_name: string;
  action_type: string;
  description: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
  pending_sync?: boolean;
  sync_status?: SyncStatus;
}

export type ActivityLogCreateInput = Omit<ActivityLog, "id" | "created_at" | "pending_sync" | "sync_status">;
