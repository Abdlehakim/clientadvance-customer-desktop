import type { Client, ClientCreateInput, ClientUpdateInput } from "@/domain/types";

export interface ClientRepository {
  getAll(): Client[] | Promise<Client[]>;
  getById(id: string): Client | null | Promise<Client | null>;
  create(input: ClientCreateInput): Client | Promise<Client>;
  update(id: string, patch: ClientUpdateInput): void | Promise<void>;
  delete(id: string): void | Promise<void>;
}
