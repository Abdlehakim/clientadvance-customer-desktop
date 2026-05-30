import type {
  EmployeeAccount,
  EmployeeAccountCreateInput,
  EmployeePasswordChangeInput,
  EmployeeAccountUpdateInput,
} from "@/domain/types";
import { apiFetch } from "./apiClient";

export const userRemoteService = {
  list() {
    return apiFetch<EmployeeAccount[]>("/users");
  },
  create(input: EmployeeAccountCreateInput) {
    return apiFetch<EmployeeAccount>("/users", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  update(id: string, patch: EmployeeAccountUpdateInput) {
    return apiFetch<EmployeeAccount>(`/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
  changeOwnPassword(input: EmployeePasswordChangeInput) {
    return apiFetch<EmployeeAccount>("/users/me/password", {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  delete(id: string) {
    return apiFetch<void>(`/users/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
};
