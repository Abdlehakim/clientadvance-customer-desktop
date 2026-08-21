import type { Role } from "./user";

export type EmployeeSyncAction = "none" | "create" | "update" | "delete";

export interface EmployeeAccount {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  displayPassword?: string;
  sync_status?: "local" | "synced";
  pending_sync?: boolean;
  sync_action?: EmployeeSyncAction;
  deleted_at?: string | null;
}

export interface EmployeeAccountListResult {
  employees: EmployeeAccount[];
  source: "backend" | "local";
  serverUnavailable: boolean;
}

export interface EmployeeAccountCreateInput {
  name: string;
  email: string;
  phone?: string;
  password: string;
  role: "employe";
}

export interface EmployeeAccountUpdateInput {
  name?: string;
  phone?: string;
  password?: string;
  is_active?: boolean;
}

export interface EmployeePasswordChangeInput {
  currentPassword: string;
  newPassword: string;
}
