import type { Syncable } from "./sync";

export interface Payment extends Syncable {
  server_version: number;
  client_id: string;
  montant: number;
  date_paiement: string;
  heure_paiement: string;
  created_by: string;
  created_at: string;
  remote_updated_at?: string;
  deleted_at?: string | null;
}

export type PaymentCreateInput = Omit<
  Payment,
  "id" | "created_by" | "created_at" | "pending_sync" | "sync_status" | "remote_updated_at" | "server_version" | "deleted_at"
>;
