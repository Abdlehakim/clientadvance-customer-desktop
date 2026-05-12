/** Remote payment repository for the real backend. Endpoints: GET/POST /payments and GET /payments/client/:clientId */
import type { PaymentRepository } from "@/domain/repositories";
import { apiFetch } from "./apiClient";

export const paymentRemoteRepository: PaymentRepository = {
  async getAll() { return apiFetch("/payments"); },
  async getByClientId(clientId) { return apiFetch(`/payments/client/${encodeURIComponent(clientId)}`); },
  async create(input) { return apiFetch("/payments", { method: "POST", body: JSON.stringify(input) }); },
};