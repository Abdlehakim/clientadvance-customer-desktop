import type { SyncEntityType } from "@/domain/types";
import { uid } from "@/infrastructure/local/localStorageDatabase";
import { getDb, type SqliteRow, type SqliteStatement } from "./sqliteClient";

interface ConflictRow extends SqliteRow {
  id: unknown;
  company_id: unknown;
  operation_id: unknown;
  entity_type: unknown;
  entity_id: unknown;
  local_payload_json: unknown;
  server_payload_json: unknown;
  base_version: unknown;
  server_version: unknown;
  message: unknown;
  created_at: unknown;
}

export interface SyncConflictInput {
  id?: string;
  companyId: string;
  operationId: string;
  entityType: SyncEntityType;
  entityId: string;
  localPayload: Record<string, unknown>;
  serverPayload: Record<string, unknown> | null;
  baseVersion: number;
  serverVersion: number | null;
  message: string | null;
  createdAt?: string;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseObject(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function toConflict(row: ConflictRow) {
  return {
    id: readString(row.id),
    company_id: readString(row.company_id),
    operation_id: readString(row.operation_id),
    entity_type: readString(row.entity_type) as SyncEntityType,
    entity_id: readString(row.entity_id),
    local_payload: parseObject(row.local_payload_json) ?? {},
    server_payload: parseObject(row.server_payload_json),
    base_version: Math.max(0, Math.trunc(readNumber(row.base_version))),
    server_version:
      typeof row.server_version === "number" ? Math.trunc(row.server_version) : null,
    message: typeof row.message === "string" ? row.message : null,
    created_at: readString(row.created_at),
  };
}

export function buildConflictUpsertStatement(input: SyncConflictInput): SqliteStatement {
  return {
    sql: `
      INSERT INTO sync_conflicts (
        id, company_id, operation_id, entity_type, entity_id,
        local_payload_json, server_payload_json, base_version,
        server_version, message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(company_id, entity_type, entity_id) DO UPDATE SET
        operation_id = excluded.operation_id,
        local_payload_json = excluded.local_payload_json,
        server_payload_json = excluded.server_payload_json,
        base_version = excluded.base_version,
        server_version = excluded.server_version,
        message = excluded.message,
        created_at = excluded.created_at
    `,
    params: [
      input.id ?? uid(),
      input.companyId,
      input.operationId,
      input.entityType,
      input.entityId,
      JSON.stringify(input.localPayload),
      input.serverPayload ? JSON.stringify(input.serverPayload) : null,
      Math.max(0, Math.trunc(input.baseVersion)),
      input.serverVersion,
      input.message,
      input.createdAt ?? new Date().toISOString(),
    ],
  };
}

export const syncConflictSQLiteRepository = {
  async upsertConflict(input: SyncConflictInput) {
    const db = await getDb();
    await db.transaction([buildConflictUpsertStatement(input)]);
  },

  async getForEntity(
    companyId: string,
    entityType: SyncEntityType,
    entityId: string,
  ) {
    const db = await getDb();
    const rows = await db.query<ConflictRow>(`
      SELECT * FROM sync_conflicts
      WHERE company_id = ? AND entity_type = ? AND entity_id = ?
      LIMIT 1
    `, [companyId, entityType, entityId]);
    return rows[0] ? toConflict(rows[0]) : null;
  },

  async removeForEntity(
    companyId: string,
    entityType: SyncEntityType,
    entityId: string,
  ) {
    const db = await getDb();
    await db.execute(`
      DELETE FROM sync_conflicts
      WHERE company_id = ? AND entity_type = ? AND entity_id = ?
    `, [companyId, entityType, entityId]);
  },

  async count(companyId: string) {
    const db = await getDb();
    const rows = await db.query<{ count: unknown }>(`
      SELECT COUNT(*) AS count FROM sync_conflicts WHERE company_id = ?
    `, [companyId]);
    return readNumber(rows[0]?.count);
  },
};
