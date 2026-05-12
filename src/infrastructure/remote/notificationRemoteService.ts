/**
 * Remote notification queue service for the real backend.
 *
 * Endpoints:
 *   POST /notifications/email     { recipient, subject, body, payment_id? }
 *   POST /notifications/whatsapp  { recipient, body, subject?, payment_id? }
 *
 * The backend remains responsible for server-side notification delivery.
 * Desktop SMTP fallback is handled separately in the Tauri app for email only.
 */
import { apiFetch, ApiError } from "./apiClient";

export const notificationRemoteService = {
  async sendEmail(recipient: string, subject: string, body: string, payment_id?: string) {
    return apiFetch("/notifications/email", {
      method: "POST",
      body: JSON.stringify({ recipient, subject, body, payment_id }),
    });
  },
  async sendWhatsApp(recipient: string, body: string, subject?: string, payment_id?: string) {
    return apiFetch("/notifications/whatsapp", {
      method: "POST",
      body: JSON.stringify({ recipient, body, subject, payment_id }),
    });
  },
};

export function isNotificationBackendUnavailable(error: unknown) {
  return error instanceof ApiError && error.status === 0;
}
