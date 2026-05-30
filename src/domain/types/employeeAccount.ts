import type { Role } from "./user";

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
