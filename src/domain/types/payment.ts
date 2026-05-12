import type { Syncable } from "./sync";

export interface Payment extends Syncable {
  client_id: string;
  montant: number;
  date_paiement: string;
  heure_paiement: string;
  created_by: string;
  created_at: string;
  remote_updated_at?: string;
}

export type PaymentCreateInput = Omit<
  Payment,
  "id" | "created_by" | "created_at" | "pending_sync" | "sync_status" | "remote_updated_at"
>;
