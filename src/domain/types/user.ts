export type Role = "admin" | "employe";

export interface User {
  id: string;
  email: string;
  phone?: string;
  password: string; // kept empty in persisted session payloads
  name: string;
  role: Role;
  is_active?: boolean;
  company_id?: string | null;
  company_name?: string | null;
  company_status?: "active" | "suspended" | "archived" | null;
  account_expires_at?: string | null;
  company_contact_email?: string | null;
  company_contact_phone?: string | null;
  company_admin_name?: string | null;
  company_admin_email?: string | null;
  admin_email?: string | null;
  admin_whatsapp?: string | null;
  server_mode?: "with-server" | "without-server" | null;
  notification_delivery_mode?: "backend" | "desktop-email" | null;
}
