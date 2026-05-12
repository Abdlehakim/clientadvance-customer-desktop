/**
 * Remote client repository — placeholder.
 *
 * Endpoints:
 *   GET    /clients
 *   POST   /clients
 *   PUT    /clients/:id
 *   DELETE /clients/:id
 */
import type { ClientRepository } from "@/domain/repositories";
import { apiFetch } from "./apiClient";

export const clientRemoteRepository: ClientRepository = {
  async getAll() { return apiFetch("/clients"); },
  async getById(id) { return apiFetch(`/clients/${id}`); },
  async create(input) { return apiFetch("/clients", { method: "POST", body: JSON.stringify(input) }); },
  async update(id, patch) { await apiFetch(`/clients/${id}`, { method: "PUT", body: JSON.stringify(patch) }); },
  async delete(id) { await apiFetch(`/clients/${id}`, { method: "DELETE" }); },
};
