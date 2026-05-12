import type { SyncRepository } from "@/domain/repositories";
import { localSyncService } from "./localSyncService";
import { backendSyncService } from "./backendSyncService";

const useLocalAuth = import.meta.env.VITE_USE_LOCAL_AUTH === "true";

export const syncService: SyncRepository = useLocalAuth ? localSyncService : backendSyncService;
