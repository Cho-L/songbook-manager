export type UserRole = "admin" | "user" | "super_admin";

export interface Profile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
}
