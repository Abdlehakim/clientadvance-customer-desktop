import type { Syncable } from "./sync";

export type ServerMode = "with-server" | "without-server";
export type NotificationDeliveryMode = "backend" | "desktop-email";
export type SmtpProviderType = "custom" | "gmail" | "professional";

export interface AdminSettings extends Syncable {
  server_version: number;
  id: string;
  admin_email: string;
  admin_whatsapp: string;
  notification_retention_days: number;
  setup_completed: boolean;
  server_mode: ServerMode;
  notification_delivery_mode: NotificationDeliveryMode;
  smtp_provider_type: SmtpProviderType;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password?: string;
  smtp_password_configured: boolean;
  smtp_secure: boolean;
  smtp_from_email: string;
  smtp_from_name: string;
  updated_at: string;
  updated_by?: string;
  remote_updated_at?: string;
}

export type AdminSettingsUpdateInput = Partial<
  Pick<
    AdminSettings,
    | "admin_email"
    | "admin_whatsapp"
    | "notification_retention_days"
    | "setup_completed"
    | "server_mode"
    | "notification_delivery_mode"
    | "smtp_provider_type"
    | "smtp_host"
    | "smtp_port"
    | "smtp_username"
    | "smtp_password"
    | "smtp_secure"
    | "smtp_from_email"
    | "smtp_from_name"
  >
>;
