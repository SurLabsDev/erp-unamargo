import { asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "operator";
  isActive: boolean;
};

export async function listUsers(): Promise<UserRow[]> {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
    })
    .from(users)
    .orderBy(asc(users.name));
}
