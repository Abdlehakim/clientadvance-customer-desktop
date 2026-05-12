export type LicenseStateStatus =
  | "active"
  | "expired"
  | "invalid"
  | "revoked"
  | "suspended";

export type LicenseAdminStatus = "active" | "expired" | "revoked" | "suspended";
export type LicenseServerMode = "with-server" | "without-server";
export type LicenseNotificationDeliveryMode = "backend" | "desktop-email";

export interface LicenseState {
  id: string;
  license_key_hash: string;
  license_token: string;
  device_id: string;
  license_status: LicenseStateStatus;
  company_id: string | null;
  company_name: string | null;
  admin_email?: string | null;
  admin_whatsapp?: string | null;
  server_mode?: LicenseServerMode | null;
  notification_delivery_mode?: LicenseNotificationDeliveryMode | null;
  customer_name: string | null;
  activated_at: string;
  expires_at: string | null;
  last_checked_at: string | null;
  last_validated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NormalizedLicenseState {
  licenseToken: string;
  deviceId: string | null;
  licenseStatus: LicenseStateStatus;
  companyId: string | null;
  companyName: string | null;
  customerName: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  lastCheckedAt: string | null;
  lastValidatedAt: string | null;
  licenseKeyMasked?: string | null;
}

export interface LicenseActivationResponse {
  license_token: string;
  device_id: string;
  company_id: string | null;
  company_name: string | null;
  server_mode?: LicenseServerMode | null;
  notification_delivery_mode?: LicenseNotificationDeliveryMode | null;
  customer_name: string | null;
  expires_at: string | null;
  status: "active";
}

export interface LicenseCheckActiveResponse {
  status: "active";
  company_id: string | null;
  company_name: string | null;
  admin_email?: string | null;
  admin_whatsapp?: string | null;
  server_mode?: LicenseServerMode | null;
  notification_delivery_mode?: LicenseNotificationDeliveryMode | null;
  customer_name: string | null;
  expires_at: string | null;
  checked_at: string;
}

export interface LicenseCheckLockedResponse {
  status: "expired" | "revoked" | "suspended";
  message: string;
}

export type LicenseCheckResponse =
  | LicenseCheckActiveResponse
  | LicenseCheckLockedResponse;

export interface DecodedLicenseToken {
  type: string | null;
  licenseId: string | null;
  companyId: string | null;
  companyName: string | null;
  customerName: string | null;
  deviceId: string | null;
  expiresAt: string | null;
  issuedAt: string | null;
  appVersion: string | null;
  status: string | null;
  tokenExpiresAt: string | null;
}
