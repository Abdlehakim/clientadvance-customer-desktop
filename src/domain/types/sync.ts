export type SyncStatus = "local" | "pending" | "synced" | "failed";

export interface Syncable {
  id: string;
  pending_sync: boolean;
  sync_status: SyncStatus;
}

export type SyncEntityType = "client" | "payment" | "adminSettings";
export type SyncOperationAction = "create" | "update" | "delete";
export type SyncOperationStatus = "applied" | "duplicate" | "conflict" | "failed";

export interface SyncOutboxOperation {
  operation_id: string;
  company_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  action: SyncOperationAction;
  base_version: number;
  payload: Record<string, unknown>;
  status: "pending" | "conflict";
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncOperationResult {
  operation_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  status: SyncOperationStatus;
  server_version: number | null;
  server_record: Record<string, unknown> | null;
  message: string | null;
}

export interface SyncChange {
  seq: string;
  entity_type: SyncEntityType | "notification" | "activityLog";
  entity_id: string;
  operation: "upsert" | "delete";
  entity_version: number | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}
