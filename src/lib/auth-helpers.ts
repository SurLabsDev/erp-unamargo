import { eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { users, type User } from "@/lib/db/schema";

export const ETIQUETA_USUARIOS = "usuarios";

/**
 * El usuario de la sesion, verificado contra la base.
 *
 * **Esta era la consulta mas ejecutada del ERP, lejos.** Corre en cada pedido
 * de cada pantalla, y con `cache()` de React -que solo deduplica dentro de un
 * mismo render- cada navegacion pagaba su ida a la base. En los logs, cuando
 * algo se caia, la consulta que aparecia timeouteada era siempre esta.
 *
 * Se sigue verificando contra la base, no contra el token: el token dice quien
 * sos y sobrevive 30 dias, asi que confiar solo en el dejaria entrar a alguien
 * dado de baja durante un mes (PROMPT_ERP.md §5). Lo que cambia es que el
 * resultado se guarda 15 segundos y se limpia por etiqueta cuando se toca un
 * usuario.
 *
 * El precio esta medido y es chico: dar de baja a alguien lo saca en 15
 * segundos en vez de instantaneamente, y cualquier accion que edite usuarios
 * limpia la etiqueta de inmediato. A cambio, la consulta que mas corria pasa a
 * correr una vez cada 15 segundos por usuario.
 */
const usuarioCacheado = unstable_cache(
  async (id: string) => {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!user || !user.isActive) return null;
    // Se guarda plano: lo que entra a la cache pasa por JSON y una `Date`
    // vuelve como texto.
    return { ...user, createdAt: user.createdAt.toISOString() };
  },
  ["usuario"],
  { revalidate: 15, tags: [ETIQUETA_USUARIOS] },
);

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  const fila = await usuarioCacheado(id);
  if (!fila) return null;
  return { ...fila, createdAt: new Date(fila.createdAt) };
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
