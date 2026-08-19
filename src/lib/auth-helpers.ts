import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { users, type User } from "@/lib/db/schema";

// Re-checks the user against the DB on every request: a deactivated user's
// live session expires on their next navigation (PROMPT_ERP.md §5).
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user || !user.isActive) return null;
  return user;
});

/** For pages/layouts: redirects to /login when there is no valid active user. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For admin-only pages: non-admins are sent back to the panel. */
export async function requireAdminPage(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}

/**
 * For server actions/route handlers: throws instead of redirecting so the
 * caller can map it to a 403 with a Spanish message.
 */
export class ForbiddenError extends Error {
  constructor(message = "No tenés permisos para realizar esta acción.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function requireRole(role?: "admin"): Promise<User> {
  const user = await getCurrentUser();
  if (!user)
    throw new ForbiddenError("Tu sesión expiró. Iniciá sesión de nuevo.");
  if (role === "admin" && user.role !== "admin") throw new ForbiddenError();
  return user;
}
