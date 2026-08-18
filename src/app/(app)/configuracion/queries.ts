import { asc, eq } from "drizzle-orm";
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
  return (
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
      })
      .from(users)
      // La cuenta de soporte de Surlabs no se muestra al cliente. El conteo
      // "N de 5 usuarios activos" se deriva de esta misma lista, asi que
      // filtrar aca la excluye tambien del tope.
      .where(eq(users.isSupport, false))
      .orderBy(asc(users.name))
  );
}
