import type { User } from "@/domain/types";

export interface AuthRepository {
  login(identifier: string, password: string): User | null | Promise<User | null>;
  logout(): void | Promise<void>;
  getCurrentUser(): User | null;
}
