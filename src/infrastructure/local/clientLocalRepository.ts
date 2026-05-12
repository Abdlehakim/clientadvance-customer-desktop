import type { ClientRepository } from "@/domain/repositories";
import type { Client } from "@/domain/types";
import { normalizeStoredTunisianPhone } from "@/lib/tunisianPhone";
import { KEYS, read, uid, write } from "./localStorageDatabase";
import { authLocalRepository } from "./authLocalRepository";
import { activityLogLocalRepository } from "./activityLogLocalRepository";

const list = () => read<Client[]>(KEYS.clients, []);
const visible = () => list().filter((client) => !client.deleted_at);

export const clientLocalRepository: ClientRepository = {
  getAll() {
    return visible();
  },
  getById(id) {
    return visible().find((client) => client.id === id) ?? null;
  },
  create(input) {
    const user = authLocalRepository.getCurrentUser();
    const now = new Date().toISOString();
    const nextInput = {
      ...input,
      telephone: normalizeStoredTunisianPhone(input.telephone),
    };
    const client: Client = {
      ...nextInput,
      id: uid(),
      created_at: now,
      updated_at: now,
      created_by: user?.name ?? "—",
      updated_by: user?.name ?? "—",
      deleted_at: null,
      remote_updated_at: now,
      pending_sync: true,
      sync_status: "pending",
    };

    write(KEYS.clients, [client, ...list()]);
    activityLogLocalRepository.create({
      user_id: user?.id ?? "",
      user_name: user?.name ?? "—",
      action_type: "client_create",
      description: `Création du client ${client.nom_complet}`,
      entity_type: "client",
      entity_id: client.id,
    });
    return client;
  },
  update(id, patch) {
    const user = authLocalRepository.getCurrentUser();
    const now = new Date().toISOString();
    const normalizedPatch =
      patch.telephone === undefined
        ? patch
        : {
            ...patch,
            telephone: normalizeStoredTunisianPhone(patch.telephone),
          };
    const next = list().map((client) =>
      client.id === id
        ? {
            ...client,
            ...normalizedPatch,
            updated_at: now,
            updated_by: user?.name ?? client.updated_by,
            remote_updated_at: now,
            pending_sync: true,
            sync_status: "pending" as const,
          }
        : client,
    );

    write(KEYS.clients, next);
    activityLogLocalRepository.create({
      user_id: user?.id ?? "",
      user_name: user?.name ?? "—",
      action_type: "client_update",
      description: `Modification du client ${normalizedPatch.nom_complet ?? id}`,
      entity_type: "client",
      entity_id: id,
    });
  },
  delete(id) {
    const user = authLocalRepository.getCurrentUser();
    const deletedAt = new Date().toISOString();
    const client = list().find((item) => item.id === id);
    const next = list().map((item) =>
      item.id === id
        ? {
            ...item,
            deleted_at: deletedAt,
            updated_at: deletedAt,
            updated_by: user?.name ?? item.updated_by,
            remote_updated_at: deletedAt,
            pending_sync: true,
            sync_status: "pending" as const,
          }
        : item,
    );

    write(KEYS.clients, next);
    activityLogLocalRepository.create({
      user_id: user?.id ?? "",
      user_name: user?.name ?? "—",
      action_type: "client_delete",
      description: `Suppression du client ${client?.nom_complet ?? id}`,
      entity_type: "client",
      entity_id: id,
    });
  },
};
