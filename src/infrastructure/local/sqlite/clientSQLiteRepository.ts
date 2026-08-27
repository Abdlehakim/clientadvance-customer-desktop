import type { ClientRepository } from "@/domain/repositories";
import type { Client, ClientCreateInput, ClientUpdateInput } from "@/domain/types";
import { getCurrentUserSession } from "@/infrastructure/auth/currentUserSession";
import { requireCurrentCompanyScope } from "@/infrastructure/auth/currentCompanyScope";
import { uid } from "@/infrastructure/local/localStorageDatabase";
import { normalizeStoredTunisianPhone } from "@/lib/tunisianPhone";
import { activityLogSQLiteRepository } from "./activityLogSQLiteRepository";
import { getDb, type SqliteRow, type SqliteStatement } from "./sqliteClient";
import {
  buildOutboxRemoveStatement,
  buildOutboxUpsertStatement,
  syncOutboxSQLiteRepository,
} from "./syncOutboxSQLiteRepository";

interface ClientSqliteRow extends SqliteRow {
  id: unknown;
  nom_complet: unknown;
  telephone: unknown;
  adresse: unknown;
  email: unknown;
  cin: unknown;
  cin_issued_at: unknown;
  birth_date: unknown;
  created_at: unknown;
  updated_at: unknown;
  created_by: unknown;
  updated_by: unknown;
  deleted_at: unknown;
  remote_updated_at: unknown;
  server_version: unknown;
  pending_sync: unknown;
  sync_status: unknown;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "1" || value.toLowerCase() === "true";
  return false;
}

function readSyncStatus(value: unknown): Client["sync_status"] {
  return value === "failed" || value === "synced" || value === "local" || value === "pending"
    ? value
    : "pending";
}

function toClient(row: ClientSqliteRow): Client {
  return {
    id: readString(row.id),
    server_version: Math.max(0, Math.trunc(readNumber(row.server_version))),
    nom_complet: readString(row.nom_complet),
    telephone: readString(row.telephone),
    adresse: readString(row.adresse),
    email: readString(row.email),
    cin: readString(row.cin),
    cinIssuedAt: readString(row.cin_issued_at),
    birthDate: readString(row.birth_date),
    created_at: readString(row.created_at),
    updated_at: readString(row.updated_at),
    created_by: readString(row.created_by),
    updated_by: readString(row.updated_by),
    deleted_at: readNullableString(row.deleted_at),
    remote_updated_at: readNullableString(row.remote_updated_at) ?? undefined,
    pending_sync: readBoolean(row.pending_sync),
    sync_status: readSyncStatus(row.sync_status),
  };
}

const CLIENT_COLUMNS = `
  id, nom_complet, telephone, adresse, email, cin, cin_issued_at,
  birth_date, created_at, updated_at, created_by, updated_by,
  deleted_at, remote_updated_at, server_version, pending_sync, sync_status
`;

async function getExistingClient(id: string, companyScope: string) {
  const db = await getDb();
  const rows = await db.query<ClientSqliteRow>(`
    SELECT ${CLIENT_COLUMNS}
    FROM clients WHERE id = ? AND company_id = ? LIMIT 1
  `, [id, companyScope]);
  return rows[0] ? toClient(rows[0]) : null;
}

export function toClientOperationPayload(client: Client): Record<string, unknown> {
  return {
    nom_complet: client.nom_complet,
    telephone: client.telephone,
    adresse: client.adresse,
    email: client.email,
    cin: client.cin,
    cinIssuedAt: client.cinIssuedAt ?? "",
    birthDate: client.birthDate ?? "",
    created_at: client.created_at,
    updated_at: client.updated_at,
    deleted_at: client.deleted_at ?? null,
  };
}

export async function getScopedClientById(id: string, companyScope: string) {
  const client = await getExistingClient(id, companyScope);
  return client?.deleted_at ? null : client;
}

function clientInsertStatement(client: Client, companyScope: string): SqliteStatement {
  return {
    sql: `
      INSERT INTO clients (
        id, company_id, nom_complet, telephone, adresse, email, cin,
        cin_issued_at, birth_date, created_at, updated_at, created_by,
        updated_by, deleted_at, remote_updated_at, server_version,
        pending_sync, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    params: [
      client.id, companyScope, client.nom_complet, client.telephone,
      client.adresse, client.email, client.cin, client.cinIssuedAt ?? "",
      client.birthDate ?? "", client.created_at, client.updated_at,
      client.created_by, client.updated_by, client.deleted_at ?? null,
      client.remote_updated_at ?? null, client.server_version, 1, client.sync_status,
    ],
  };
}

export const clientSQLiteRepository: ClientRepository = {
  async getAll() {
    const companyScope = requireCurrentCompanyScope();
    const db = await getDb();
    const rows = await db.query<ClientSqliteRow>(`
      SELECT ${CLIENT_COLUMNS}
      FROM clients
      WHERE company_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
    `, [companyScope]);
    return rows.map(toClient);
  },

  async getById(id) {
    const companyScope = requireCurrentCompanyScope();
    const client = await getExistingClient(id, companyScope);
    return client?.deleted_at ? null : client;
  },

  async create(input: ClientCreateInput) {
    const companyScope = requireCurrentCompanyScope();
    const user = getCurrentUserSession();
    const now = new Date().toISOString();
    const client: Client = {
      ...input,
      cinIssuedAt: input.cinIssuedAt ?? "",
      birthDate: input.birthDate ?? "",
      telephone: normalizeStoredTunisianPhone(input.telephone),
      id: uid(),
      server_version: 0,
      created_at: now,
      updated_at: now,
      created_by: user?.name ?? "-",
      updated_by: user?.name ?? "-",
      deleted_at: null,
      remote_updated_at: now,
      pending_sync: true,
      sync_status: "pending",
    };
    const db = await getDb();
    await db.transaction([
      clientInsertStatement(client, companyScope),
      buildOutboxUpsertStatement({
        companyId: companyScope,
        entityType: "client",
        entityId: client.id,
        action: "create",
        baseVersion: 0,
        payload: toClientOperationPayload(client),
        now,
      }),
    ]);
    await activityLogSQLiteRepository.create({
      user_id: user?.id ?? "",
      user_name: user?.name ?? "-",
      action_type: "client_create",
      description: `Creation du client ${client.nom_complet}`,
      entity_type: "client",
      entity_id: client.id,
    });
    return client;
  },

  async update(id: string, patch: ClientUpdateInput) {
    const companyScope = requireCurrentCompanyScope();
    const current = await getExistingClient(id, companyScope);
    if (!current) return;
    const user = getCurrentUserSession();
    const now = new Date().toISOString();
    const normalizedPatch = patch.telephone === undefined
      ? patch
      : { ...patch, telephone: normalizeStoredTunisianPhone(patch.telephone) };
    const next: Client = {
      ...current,
      ...normalizedPatch,
      updated_at: now,
      updated_by: user?.name ?? current.updated_by,
      remote_updated_at: now,
      pending_sync: true,
      sync_status: "pending",
    };
    const db = await getDb();
    await db.transaction([
      {
        sql: `
          UPDATE clients SET nom_complet = ?, telephone = ?, adresse = ?,
            email = ?, cin = ?, cin_issued_at = ?, birth_date = ?,
            updated_at = ?, updated_by = ?, remote_updated_at = ?,
            pending_sync = 1, sync_status = 'pending'
          WHERE id = ? AND company_id = ?
        `,
        params: [
          next.nom_complet, next.telephone, next.adresse, next.email, next.cin,
          next.cinIssuedAt ?? "", next.birthDate ?? "", next.updated_at,
          next.updated_by, next.remote_updated_at ?? null, id, companyScope,
        ],
      },
      buildOutboxUpsertStatement({
        companyId: companyScope,
        entityType: "client",
        entityId: id,
        action: "update",
        baseVersion: current.server_version,
        payload: toClientOperationPayload(next),
        now,
      }),
    ]);
    await activityLogSQLiteRepository.create({
      user_id: user?.id ?? "",
      user_name: user?.name ?? "-",
      action_type: "client_update",
      description: `Modification du client ${normalizedPatch.nom_complet ?? id}`,
      entity_type: "client",
      entity_id: id,
    });
  },

  async delete(id: string) {
    const companyScope = requireCurrentCompanyScope();
    const current = await getExistingClient(id, companyScope);
    if (!current) return;
    const user = getCurrentUserSession();
    const now = new Date().toISOString();
    const existingOperation = await syncOutboxSQLiteRepository.getForEntity(
      companyScope,
      "client",
      id,
    );
    const db = await getDb();

    if (existingOperation?.action === "create") {
      await db.transaction([
        buildOutboxRemoveStatement(existingOperation.operation_id),
        { sql: "DELETE FROM sync_conflicts WHERE company_id = ? AND entity_type = 'client' AND entity_id = ?", params: [companyScope, id] },
        { sql: "DELETE FROM clients WHERE id = ? AND company_id = ?", params: [id, companyScope] },
      ]);
    } else {
      const deleted: Client = {
        ...current,
        deleted_at: now,
        updated_at: now,
        updated_by: user?.name ?? current.updated_by,
        remote_updated_at: now,
        pending_sync: true,
        sync_status: "pending",
      };
      await db.transaction([
        {
          sql: `
            UPDATE clients SET deleted_at = ?, updated_at = ?, updated_by = ?,
              remote_updated_at = ?, pending_sync = 1, sync_status = 'pending'
            WHERE id = ? AND company_id = ?
          `,
          params: [now, now, deleted.updated_by, now, id, companyScope],
        },
        buildOutboxUpsertStatement({
          companyId: companyScope,
          entityType: "client",
          entityId: id,
          action: "delete",
          baseVersion: current.server_version,
          payload: toClientOperationPayload(deleted),
          now,
        }),
      ]);
    }

    await activityLogSQLiteRepository.create({
      user_id: user?.id ?? "",
      user_name: user?.name ?? "-",
      action_type: "client_delete",
      description: `Suppression du client ${current.nom_complet ?? id}`,
      entity_type: "client",
      entity_id: id,
    });
  },
};
