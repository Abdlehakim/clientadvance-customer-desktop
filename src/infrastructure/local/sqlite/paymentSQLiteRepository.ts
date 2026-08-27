import type { PaymentRepository } from "@/domain/repositories";
import type { AdminSettings, Client, Payment, PaymentCreateInput } from "@/domain/types";
import { getCurrentUserSession } from "@/infrastructure/auth/currentUserSession";
import { requireCurrentCompanyScope } from "@/infrastructure/auth/currentCompanyScope";
import { uid } from "@/infrastructure/local/localStorageDatabase";
import { formatTND } from "@/lib/format";
import { buildPaymentNotifications } from "@/services/paymentNotificationService";
import { activityLogSQLiteRepository } from "./activityLogSQLiteRepository";
import { adminSettingsSQLiteRepository } from "./adminSettingsSQLiteRepository";
import { getScopedClientById } from "./clientSQLiteRepository";
import { notificationSQLiteRepository } from "./notificationSQLiteRepository";
import { getDb, type SqliteRow, type SqliteStatement } from "./sqliteClient";
import {
  buildOutboxRemoveStatement,
  buildOutboxUpsertStatement,
  syncOutboxSQLiteRepository,
} from "./syncOutboxSQLiteRepository";

type PaymentClient = Client & { nom_complet?: string; email?: string; telephone?: string };

interface PaymentSqliteRow extends SqliteRow {
  id: unknown;
  client_id: unknown;
  montant: unknown;
  date_paiement: unknown;
  heure_paiement: unknown;
  created_by: unknown;
  created_at: unknown;
  remote_updated_at: unknown;
  server_version: unknown;
  deleted_at: unknown;
  pending_sync: unknown;
  sync_status: unknown;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function readBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return typeof value === "string" && (value === "1" || value.toLowerCase() === "true");
}

function readSyncStatus(value: unknown): Payment["sync_status"] {
  return value === "failed" || value === "synced" || value === "local" || value === "pending"
    ? value
    : "pending";
}

function toPayment(row: PaymentSqliteRow): Payment {
  return {
    id: readString(row.id),
    server_version: Math.max(0, Math.trunc(readNumber(row.server_version))),
    client_id: readString(row.client_id),
    montant: readNumber(row.montant),
    date_paiement: readString(row.date_paiement),
    heure_paiement: readString(row.heure_paiement),
    created_by: readString(row.created_by),
    created_at: readString(row.created_at),
    remote_updated_at: typeof row.remote_updated_at === "string" ? row.remote_updated_at : undefined,
    deleted_at: typeof row.deleted_at === "string" ? row.deleted_at : null,
    pending_sync: readBoolean(row.pending_sync),
    sync_status: readSyncStatus(row.sync_status),
  };
}

const PAYMENT_COLUMNS = `
  id, client_id, montant, date_paiement, heure_paiement, created_by,
  created_at, remote_updated_at, server_version, deleted_at,
  pending_sync, sync_status
`;

export function toPaymentOperationPayload(payment: Payment): Record<string, unknown> {
  return {
    client_id: payment.client_id,
    montant: payment.montant,
    date_paiement: payment.date_paiement,
    heure_paiement: payment.heure_paiement,
    created_at: payment.created_at,
    deleted_at: payment.deleted_at ?? null,
  };
}

async function getExistingPayment(id: string, companyScope: string) {
  const db = await getDb();
  const rows = await db.query<PaymentSqliteRow>(`
    SELECT ${PAYMENT_COLUMNS}
    FROM payments WHERE id = ? AND company_id = ? LIMIT 1
  `, [id, companyScope]);
  return rows[0] ? toPayment(rows[0]) : null;
}

async function getPaymentClient(clientId: string, companyScope: string): Promise<PaymentClient | null> {
  const client = await getScopedClientById(clientId, companyScope);
  return client ? client as PaymentClient : null;
}

async function getClientTotalPaid(clientId: string, companyScope: string) {
  const db = await getDb();
  const rows = await db.query<{ total_paid: unknown }>(`
    SELECT COALESCE(SUM(montant), 0) AS total_paid
    FROM payments
    WHERE client_id = ? AND company_id = ? AND deleted_at IS NULL
  `, [clientId, companyScope]);
  return readNumber(rows[0]?.total_paid);
}

async function queuePaymentNotifications(
  payment: Payment,
  client: PaymentClient,
  settings: AdminSettings,
  actorName: string,
  totalPaid: number,
) {
  const notifications = buildPaymentNotifications(payment, client, settings, actorName, totalPaid);
  await Promise.all(notifications.map((notification) => notificationSQLiteRepository.create(notification)));
}

function paymentInsertStatement(payment: Payment, companyScope: string): SqliteStatement {
  return {
    sql: `
      INSERT INTO payments (
        id, company_id, client_id, montant, date_paiement, heure_paiement,
        created_by, created_at, remote_updated_at, server_version, deleted_at,
        pending_sync, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    params: [
      payment.id, companyScope, payment.client_id, payment.montant,
      payment.date_paiement, payment.heure_paiement, payment.created_by,
      payment.created_at, payment.remote_updated_at ?? null,
      payment.server_version, payment.deleted_at ?? null, 1, payment.sync_status,
    ],
  };
}

export const paymentSQLiteRepository: PaymentRepository = {
  async getAll() {
    const companyScope = requireCurrentCompanyScope();
    const db = await getDb();
    const rows = await db.query<PaymentSqliteRow>(`
      SELECT ${PAYMENT_COLUMNS}
      FROM payments
      WHERE company_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
    `, [companyScope]);
    return rows.map(toPayment);
  },

  async getByClientId(clientId) {
    const companyScope = requireCurrentCompanyScope();
    const db = await getDb();
    const rows = await db.query<PaymentSqliteRow>(`
      SELECT ${PAYMENT_COLUMNS}
      FROM payments
      WHERE client_id = ? AND company_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
    `, [clientId, companyScope]);
    return rows.map(toPayment);
  },

  async create(input: PaymentCreateInput) {
    const companyScope = requireCurrentCompanyScope();
    const client = await getPaymentClient(input.client_id, companyScope);
    if (!client) throw new Error("Client introuvable.");

    const user = getCurrentUserSession();
    const now = new Date().toISOString();
    const payment: Payment = {
      ...input,
      id: uid(),
      server_version: 0,
      montant: Number(input.montant),
      created_by: user?.name ?? "-",
      created_at: now,
      remote_updated_at: now,
      deleted_at: null,
      pending_sync: true,
      sync_status: "pending",
    };
    const db = await getDb();
    await db.transaction([
      paymentInsertStatement(payment, companyScope),
      buildOutboxUpsertStatement({
        companyId: companyScope,
        entityType: "payment",
        entityId: payment.id,
        action: "create",
        baseVersion: 0,
        payload: toPaymentOperationPayload(payment),
        now,
      }),
    ]);

    await activityLogSQLiteRepository.create({
      user_id: user?.id ?? "",
      user_name: user?.name ?? "-",
      action_type: "payment_create",
      description: `Paiement de ${formatTND(payment.montant)} pour ${client.nom_complet ?? "-"}`,
      entity_type: "payment",
      entity_id: payment.id,
    });

    const settings = await adminSettingsSQLiteRepository.get() as AdminSettings;
    if (settings.server_mode === "without-server") {
      await queuePaymentNotifications(
        payment,
        client,
        settings,
        user?.name ?? "-",
        await getClientTotalPaid(payment.client_id, companyScope),
      );
    }
    return payment;
  },

  async delete(id: string) {
    const companyScope = requireCurrentCompanyScope();
    const payment = await getExistingPayment(id, companyScope);
    if (!payment) return;

    const user = getCurrentUserSession();
    const client = await getPaymentClient(payment.client_id, companyScope);
    const existingOperation = await syncOutboxSQLiteRepository.getForEntity(
      companyScope,
      "payment",
      id,
    );
    const db = await getDb();
    if (existingOperation?.action === "create") {
      await db.transaction([
        buildOutboxRemoveStatement(existingOperation.operation_id),
        { sql: "DELETE FROM sync_conflicts WHERE company_id = ? AND entity_type = 'payment' AND entity_id = ?", params: [companyScope, id] },
        { sql: "DELETE FROM payments WHERE id = ? AND company_id = ?", params: [id, companyScope] },
      ]);
    } else {
      const now = new Date().toISOString();
      const deleted = { ...payment, deleted_at: now, remote_updated_at: now };
      await db.transaction([
        {
          sql: `
            UPDATE payments SET deleted_at = ?, remote_updated_at = ?,
              pending_sync = 1, sync_status = 'pending'
            WHERE id = ? AND company_id = ?
          `,
          params: [now, now, id, companyScope],
        },
        buildOutboxUpsertStatement({
          companyId: companyScope,
          entityType: "payment",
          entityId: id,
          action: "delete",
          baseVersion: payment.server_version,
          payload: toPaymentOperationPayload(deleted),
          now,
        }),
      ]);
    }

    await db.execute(`
      DELETE FROM notification_queue
      WHERE payment_id = ? AND company_id = ?
        AND (status IS NULL OR status IN (?, ?))
    `, [id, companyScope, "queued", "sending"]);
    await activityLogSQLiteRepository.create({
      user_id: user?.id ?? "",
      user_name: user?.name ?? "-",
      action_type: "payment_delete",
      description: `Suppression du paiement de ${formatTND(payment.montant)} pour ${client?.nom_complet ?? "-"}`,
      entity_type: "payment",
      entity_id: id,
    });
  },
};
