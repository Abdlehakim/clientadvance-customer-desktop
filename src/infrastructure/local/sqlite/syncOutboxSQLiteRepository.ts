import type {
  SyncEntityType,
  SyncOperationAction,
  SyncOutboxOperation,
} from "@/domain/types";
import { uid } from "@/infrastructure/local/localStorageDatabase";
import {
  getDb,
  type SqliteRow,
  type SqliteStatement,
} from "./sqliteClient";

interface OutboxRow extends SqliteRow {
  operation_id: unknown;
  company_id: unknown;
  entity_type: unknown;
  entity_id: unknown;
  action: unknown;
  base_version: unknown;
  payload_json: unknown;
  status: unknown;
  attempt_count: unknown;
  last_error: unknown;
  created_at: unknown;
  updated_at: unknown;
}

export interface CoalescedOutboxInput {
  operationId?: string;
  companyId: string;
  entityType: SyncEntityType;
  entityId: string;
  action: SyncOperationAction;
  baseVersion: number;
  payload: Record<string, unknown>;
  now?: string;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parsePayload(value: unknown) {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function toOperation(row: OutboxRow): SyncOutboxOperation {
  const entityType = readString(row.entity_type) as SyncEntityType;
  const action = readString(row.action) as SyncOperationAction;
  return {
    operation_id: readString(row.operation_id),
    company_id: readString(row.company_id),
    entity_type: entityType,
    entity_id: readString(row.entity_id),
    action,
    base_version: Math.max(0, Math.trunc(readNumber(row.base_version))),
    payload: parsePayload(row.payload_json),
    status: readString(row.status) === "conflict" ? "conflict" : "pending",
    attempt_count: Math.max(0, Math.trunc(readNumber(row.attempt_count))),
    last_error: typeof row.last_error === "string" ? row.last_error : null,
    created_at: readString(row.created_at),
    updated_at: readString(row.updated_at),
  };
}

export function buildOutboxUpsertStatement(
  input: CoalescedOutboxInput,
): SqliteStatement {
  const now = input.now ?? new Date().toISOString();
  return {
    sql: `
      INSERT INTO sync_outbox (
        operation_id, company_id, entity_type, entity_id, action,
        base_version, payload_json, status, attempt_count, last_error,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?)
      ON CONFLICT(company_id, entity_type, entity_id) DO UPDATE SET
        action = CASE
          WHEN sync_outbox.action = 'create' AND excluded.action = 'update'
            THEN 'create'
          ELSE excluded.action
        END,
        payload_json = excluded.payload_json,
        status = CASE
          WHEN sync_outbox.status = 'conflict' THEN 'conflict'
          ELSE 'pending'
        END,
        last_error = CASE
          WHEN sync_outbox.status = 'conflict' THEN sync_outbox.last_error
          ELSE NULL
        END,
        updated_at = excluded.updated_at
    `,
    params: [
      input.operationId ?? uid(),
      input.companyId,
      input.entityType,
      input.entityId,
      input.action,
      Math.max(0, Math.trunc(input.baseVersion)),
      JSON.stringify(input.payload),
      now,
      now,
    ],
  };
}

export function buildOutboxRemoveStatement(operationId: string): SqliteStatement {
  return {
    sql: "DELETE FROM sync_outbox WHERE operation_id = ?",
    params: [operationId],
  };
}

export const syncOutboxSQLiteRepository = {
  async listPending(companyId: string) {
    const db = await getDb();
    const rows = await db.query<OutboxRow>(`
      SELECT * FROM sync_outbox
      WHERE company_id = ? AND status = 'pending'
      ORDER BY created_at ASC, operation_id ASC
    `, [companyId]);
    return rows.map(toOperation);
  },

  async getForEntity(
    companyId: string,
    entityType: SyncEntityType,
    entityId: string,
  ) {
    const db = await getDb();
    const rows = await db.query<OutboxRow>(`
      SELECT * FROM sync_outbox
      WHERE company_id = ? AND entity_type = ? AND entity_id = ?
      LIMIT 1
    `, [companyId, entityType, entityId]);
    return rows[0] ? toOperation(rows[0]) : null;
  },

  async upsert(input: CoalescedOutboxInput) {
    const db = await getDb();
    await db.transaction([buildOutboxUpsertStatement(input)]);
    return this.getForEntity(input.companyId, input.entityType, input.entityId);
  },

  async markConflict(operationId: string, message: string | null) {
    const db = await getDb();
    await db.execute(`
      UPDATE sync_outbox
      SET status = 'conflict', last_error = ?, updated_at = ?
      WHERE operation_id = ?
    `, [message, new Date().toISOString(), operationId]);
  },

  async markFailed(operationId: string, message: string | null) {
    const db = await getDb();
    await db.execute(`
      UPDATE sync_outbox
      SET attempt_count = attempt_count + 1,
          last_error = ?,
          updated_at = ?
      WHERE operation_id = ?
    `, [message, new Date().toISOString(), operationId]);
  },

  async remove(operationId: string) {
    const db = await getDb();
    await db.execute("DELETE FROM sync_outbox WHERE operation_id = ?", [operationId]);
  },

  async countPending(companyId: string) {
    const db = await getDb();
    const rows = await db.query<{ count: unknown }>(`
      SELECT COUNT(*) AS count FROM sync_outbox
      WHERE company_id = ? AND status = 'pending'
    `, [companyId]);
    return readNumber(rows[0]?.count);
  },
};
