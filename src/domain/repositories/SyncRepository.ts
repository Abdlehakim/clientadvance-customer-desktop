export interface SyncResult {
  ok: boolean;
  synced: number;
  conflicts?: number;
  changed?: number;
}

export interface SyncRepository {
  getPendingCount(): number;
  syncPendingData(): SyncResult | Promise<SyncResult>;
  getLastSync(): string | null;
  setOnlineMode(value: boolean): void;
  isOnlineMode(): boolean;
}
