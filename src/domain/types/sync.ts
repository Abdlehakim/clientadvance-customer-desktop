export type SyncStatus = "local" | "pending" | "synced" | "failed";

export interface Syncable {
  id: string;
  pending_sync: boolean;
  sync_status: SyncStatus;
}
