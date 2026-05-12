import type { Payment, PaymentCreateInput } from "@/domain/types";

export interface PaymentRepository {
  getAll(): Payment[] | Promise<Payment[]>;
  getByClientId(clientId: string): Payment[] | Promise<Payment[]>;
  create(input: PaymentCreateInput): Payment | Promise<Payment>;
}
