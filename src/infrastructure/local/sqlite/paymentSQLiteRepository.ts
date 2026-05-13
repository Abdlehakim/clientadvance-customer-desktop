import type { PaymentRepository } from "@/domain/repositories";
import type { AdminSettings, Client, Payment, PaymentCreateInput } from "@/domain/types";
import { formatTND } from "@/lib/format";
import { authLocalRepository } from "@/infrastructure/local/authLocalRepository";
import { uid } from "@/infrastructure/local/localStorageDatabase";
import { buildPaymentNotifications } from "@/services/paymentNotificationService";
import { activityLogSQLiteRepository } from "./activityLogSQLiteRepository";
import { adminSettingsSQLiteRepository } from "./adminSettingsSQLiteRepository";
import { clientSQLiteRepository } from "./clientSQLiteRepository";
import { notificationSQLiteRepository } from "./notificationSQLiteRepository";
import { getDb, type SqliteRow } from "./sqliteClient";

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
  pending_sync: unknown;
  sync_status: unknown;
}

interface PaymentTotalRow extends SqliteRow {
  total_paid: unknown;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function readNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function readBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    return value === "1" || value.toLowerCase() === "true";
  }

  return false;
}

function readSyncStatus(value: unknown): Payment["sync_status"] {
  return value === "failed" || value === "synced" || value === "local" || value === "pending"
    ? value
    : "pending";
}

function toPayment(row: PaymentSqliteRow): Payment {
  return {
    id: readString(row.id),
    client_id: readString(row.client_id),
    montant: readNumber(row.montant),
    date_paiement: readString(row.date_paiement),
    heure_paiement: readString(row.heure_paiement),
    created_by: readString(row.created_by),
    created_at: readString(row.created_at),
    remote_updated_at: readNullableString(row.remote_updated_at) ?? undefined,
    pending_sync: readBoolean(row.pending_sync),
    sync_status: readSyncStatus(row.sync_status),
  };
}

async function getPaymentClient(clientId: string): Promise<PaymentClient | null> {
  const sqliteClient = await clientSQLiteRepository.getById(clientId);
  return sqliteClient ? (sqliteClient as PaymentClient) : null;
}

async function getClientTotalPaid(clientId: string) {
  const db = await getDb();
  const rows = await db.query<PaymentTotalRow>(
    `
      SELECT COALESCE(SUM(montant), 0) AS total_paid
      FROM payments
      WHERE client_id = ?
    `,
    [clientId],
  );

  return readNumber(rows[0]?.total_paid);
}

async function getExistingPayment(id: string) {
  const db = await getDb();
  const rows = await db.query<PaymentSqliteRow>(
    `
      SELECT
        id,
        client_id,
        montant,
        date_paiement,
        heure_paiement,
        created_by,
        created_at,
        remote_updated_at,
        pending_sync,
        sync_status
      FROM payments
      WHERE id = ?
      LIMIT 1
    `,
    [id],
  );

  return rows[0] ? toPayment(rows[0]) : null;
}

async function queuePaymentNotifications(
  payment: Payment,
  client: PaymentClient | null,
  settings: AdminSettings,
  actorName: string,
  totalPaid: number,
) {
  const notifications = buildPaymentNotifications(
    payment,
    client,
    settings,
    actorName,
    totalPaid,
  );

  await Promise.all(
    notifications.map((notification) => notificationSQLiteRepository.create(notification)),
  );
}

export const paymentSQLiteRepository: PaymentRepository = {
  async getAll() {
    const db = await getDb();
    const rows = await db.query<PaymentSqliteRow>(
      `
        SELECT
          id,
          client_id,
          montant,
          date_paiement,
          heure_paiement,
          created_by,
          created_at,
          remote_updated_at,
          pending_sync,
          sync_status
        FROM payments
        ORDER BY created_at DESC
      `,
    );

    return rows.map(toPayment);
  },
  async getByClientId(clientId) {
    const db = await getDb();
    const rows = await db.query<PaymentSqliteRow>(
      `
        SELECT
          id,
          client_id,
          montant,
          date_paiement,
          heure_paiement,
          created_by,
          created_at,
          remote_updated_at,
          pending_sync,
          sync_status
        FROM payments
        WHERE client_id = ?
        ORDER BY created_at DESC
      `,
      [clientId],
    );

    return rows.map(toPayment);
  },
  async create(input: PaymentCreateInput) {
    const user = authLocalRepository.getCurrentUser();
    const now = new Date().toISOString();
    const payment: Payment = {
      ...input,
      id: uid(),
      montant: Number(input.montant),
      created_by: user?.name ?? "-",
      created_at: now,
      remote_updated_at: now,
      pending_sync: true,
      sync_status: "pending",
    };
    const db = await getDb();

    await db.execute(
      `
        INSERT INTO payments (
          id,
          client_id,
          montant,
          date_paiement,
          heure_paiement,
          created_by,
          created_at,
          remote_updated_at,
          pending_sync,
          sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        payment.id,
        payment.client_id,
        payment.montant,
        payment.date_paiement,
        payment.heure_paiement,
        payment.created_by,
        payment.created_at,
        payment.remote_updated_at ?? null,
        1,
        payment.sync_status,
      ],
    );

    const [client, totalPaid] = await Promise.all([
      getPaymentClient(payment.client_id),
      getClientTotalPaid(payment.client_id),
    ]);
    await activityLogSQLiteRepository.create({
      user_id: user?.id ?? "",
      user_name: user?.name ?? "-",
      action_type: "payment_create",
      description: `Paiement de ${formatTND(payment.montant)} pour ${client?.nom_complet ?? "-"}`,
      entity_type: "payment",
      entity_id: payment.id,
    });

    const settings = (await adminSettingsSQLiteRepository.get()) as AdminSettings;
    await queuePaymentNotifications(
      payment,
      client,
      settings,
      user?.name ?? "-",
      totalPaid,
    );

    return payment;
  },
  async delete(id: string) {
    const payment = await getExistingPayment(id);

    if (!payment) {
      return;
    }

    const user = authLocalRepository.getCurrentUser();
    const client = await getPaymentClient(payment.client_id);
    const db = await getDb();

    await db.execute(
      `
        DELETE FROM payments
        WHERE id = ?
      `,
      [id],
    );
    await db.execute(
      `
        DELETE FROM notification_queue
        WHERE payment_id = ?
          AND (status IS NULL OR status IN (?, ?))
      `,
      [id, "queued", "sending"],
    );

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
