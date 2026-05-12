import type { PaymentRepository } from "@/domain/repositories";
import type { Payment, AdminSettings, Client } from "@/domain/types";
import { KEYS, read, uid, write } from "./localStorageDatabase";
import { authLocalRepository } from "./authLocalRepository";
import { activityLogLocalRepository } from "./activityLogLocalRepository";
import { clientLocalRepository } from "./clientLocalRepository";
import { adminSettingsLocalRepository } from "./adminSettingsLocalRepository";
import { notificationLocalRepository } from "./notificationLocalRepository";
import { formatTND } from "@/lib/format";
import { buildPaymentNotifications } from "@/services/paymentNotificationService";

const list = () => read<Payment[]>(KEYS.payments, []);

function getClientTotalPaid(clientId: string) {
  return list()
    .filter((payment) => payment.client_id === clientId)
    .reduce((total, payment) => total + Number(payment.montant), 0);
}

type PaymentClient = Client & { nom_complet?: string; email?: string; telephone?: string };

export const paymentLocalRepository: PaymentRepository = {
  getAll() {
    return list();
  },
  getByClientId(clientId) {
    return list().filter((payment) => payment.client_id === clientId);
  },
  async create(input) {
    const user = authLocalRepository.getCurrentUser();
    const now = new Date().toISOString();
    const payment: Payment = {
      ...input,
      id: uid(),
      created_by: user?.name ?? "-",
      created_at: now,
      remote_updated_at: now,
      pending_sync: true,
      sync_status: "pending",
    };

    write(KEYS.payments, [payment, ...list()]);
    const totalPaid = getClientTotalPaid(payment.client_id);

    const client = clientLocalRepository.getById(payment.client_id) as PaymentClient | null;
    activityLogLocalRepository.create({
      user_id: user?.id ?? "",
      user_name: user?.name ?? "-",
      action_type: "payment_create",
      description: `Paiement de ${formatTND(payment.montant)} pour ${client?.nom_complet ?? "-"}`,
      entity_type: "payment",
      entity_id: payment.id,
    });

    const settings = adminSettingsLocalRepository.get() as AdminSettings;
    const notifications = buildPaymentNotifications(
      payment,
      client,
      settings,
      user?.name ?? "-",
      totalPaid,
    );

    await Promise.all(
      notifications.map((notification) =>
        Promise.resolve(notificationLocalRepository.create(notification)),
      ),
    );

    return payment;
  },
};
