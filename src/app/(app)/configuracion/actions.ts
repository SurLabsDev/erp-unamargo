"use server";

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, count, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import "@/lib/zod-locale";
import { ForbiddenError, requireRole } from "@/lib/auth-helpers";
import { db, type Tx } from "@/lib/db/client";
import { BALANCE_LOCK, USER_LIMIT_LOCK } from "@/lib/db/locks";
import {
  cashCategories,
  cashMovements,
  productCategories,
  productSubtypes,
  settings,
  users,
} from "@/lib/db/schema";
import { isValidISODate } from "@/lib/domain/dates";
import {
  USER_LIMIT_ERROR,
  alertRecipientsSchema,
  canActivateUser,
} from "@/lib/domain/limits";
import { categoryNameSchema, passwordSchema } from "@/lib/domain/money";
import { slugify, uniqueSlug } from "@/lib/domain/slug";
import { todayInTimeZone } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { avisarALaWeb } from "@/lib/avisar-web";
import { ETIQUETA_PANEL } from "../panel-cache";
import { ETIQUETA_SETTINGS } from "@/lib/settings";
import { ETIQUETA_USUARIOS } from "@/lib/auth-helpers";

export type ActionResult =
  | { ok: true; message: string; password?: string }
  | { ok: false; error: string };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

function handleError(error: unknown): ActionResult {
  if (error instanceof ForbiddenError)
    return { ok: false, error: error.message };
  console.error("[configuracion:action]", error);
  return { ok: false, error: "Ocurrió un error, intentá de nuevo." };
}

function revalidateConfig() {
  revalidatePath("/configuracion");
  revalidatePath("/dinero");
  revalidatePath("/");
  // La configuracion se lee cacheada en todas las pantallas: sin limpiar la
  // etiqueta, cambiar la moneda o la zona horaria no se veria en ningun lado.
  updateTag(ETIQUETA_SETTINGS);
  updateTag(ETIQUETA_PANEL);
  // Dar de baja a alguien tiene que sacarlo YA, no en 15 segundos.
  updateTag(ETIQUETA_USUARIOS);
}

/** Revalida las pantallas del ERP y, ademas, le avisa a la web publica.
 *  El aviso va aca adentro a proposito: cualquier accion nueva que revalide
 *  el catalogo lo hereda sin que nadie se acuerde de agregarlo. */
async function revalidateCatalog() {
  revalidatePath("/configuracion");
  revalidatePath("/stock");
  revalidatePath("/");
  await avisarALaWeb();
  // El panel lee cacheado: sin esto seguiria mostrando las cifras de antes
  // de este guardado. Va `updateTag` y no `revalidateTag` porque en Next 16
  // es el que expira YA dentro de una server action; el otro programa la
  // expiracion y el usuario veria su propio cambio recien en la visita
  // siguiente, que es justo la queja que originó todo esto.
  updateTag(ETIQUETA_PANEL);
}

function generatePassword(): string {
  return randomBytes(9).toString("base64url").slice(0, 12);
}

// --- Instance settings ------------------------------------------------------

const balanceSchema = z.object({
  initialBalance: z
    .string({ error: "El saldo inicial es obligatorio." })
    .trim()
    .min(1, { error: "El saldo inicial es obligatorio." })
    .transform((value) => value.replace(",", "."))
    .pipe(
      z
        .string()
        .regex(/^\d{1,12}(\.\d{1,2})?$/, {
          error: "El saldo inicial debe ser un número con hasta dos decimales.",
        })
        .transform((value) => Number(value).toFixed(2)),
    ),
  initialBalanceDate: z
    .string({ error: "La fecha de corte es obligatoria." })
    .refine(isValidISODate, { error: "La fecha de corte no es válida." }),
});

export async function updateBalanceSettingsAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const parsed = balanceSchema.safeParse({
      initialBalance: formData.get("initialBalance"),
      initialBalanceDate: formData.get("initialBalanceDate"),
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const { initialBalance, initialBalanceDate } = parsed.data;

    // A future cut date would make every new movement invalid ("not future"
    // AND "not before the cut" becomes an empty range) and lock the module.
    const current = await getSettings();
    if (initialBalanceDate > todayInTimeZone(current.timezone)) {
      return { ok: false, error: "La fecha de corte no puede ser futura." };
    }

    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      // Rule §7.1: no movement can predate the initial balance. The exclusive
      // BALANCE_LOCK serializes this check against concurrent movement
      // creation (which takes the shared variant).
      await tx.execute(sql`select pg_advisory_xact_lock(${BALANCE_LOCK})`);
      const [{ before }] = await tx
        .select({ before: count() })
        .from(cashMovements)
        .where(
          and(
            isNull(cashMovements.voidedAt),
            lt(cashMovements.date, initialBalanceDate),
          ),
        );
      if (before > 0) {
        return {
          ok: false,
          error: `Hay ${before} movimiento(s) con fecha anterior a esa fecha de corte. Anulalos o elegí una fecha anterior.`,
        };
      }

      await tx
        .update(settings)
        .set({ initialBalance, initialBalanceDate, updatedAt: new Date() })
        .where(eq(settings.id, 1));
      return {
        ok: true,
        message: "Saldo inicial actualizado. Todos los períodos se recalculan.",
      };
    });

    if (result.ok) revalidateConfig();
    return result;
  } catch (error) {
    return handleError(error);
  }
}

export async function updateAlertRecipientsAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const raw = [
      formData.get("recipient1"),
      formData.get("recipient2"),
      formData.get("recipient3"),
    ]
      .map((value) =>
        typeof value === "string" ? value.trim().toLowerCase() : "",
      )
      .filter((value) => value !== "");
    const parsed = alertRecipientsSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    await db
      .update(settings)
      .set({ alertRecipients: parsed.data, updatedAt: new Date() })
      .where(eq(settings.id, 1));

    revalidateConfig();
    return { ok: true, message: "Destinatarios de alertas actualizados." };
  } catch (error) {
    return handleError(error);
  }
}

// --- Categories -------------------------------------------------------------

export async function createCategoryAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const parsed = z
      .object({
        name: categoryNameSchema,
        kind: z.enum(["income", "expense"], { error: "Elegí el tipo." }),
      })
      .safeParse({ name: formData.get("name"), kind: formData.get("kind") });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    const [existing] = await db
      .select({ id: cashCategories.id })
      .from(cashCategories)
      .where(eq(cashCategories.name, parsed.data.name))
      .limit(1);
    if (existing) {
      return { ok: false, error: "Ya existe una categoría con ese nombre." };
    }

    await db.insert(cashCategories).values(parsed.data);
    revalidateConfig();
    return { ok: true, message: `Categoría "${parsed.data.name}" creada.` };
  } catch (error) {
    return handleError(error);
  }
}

export async function renameCategoryAction(
  categoryId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const parsed = categoryNameSchema.safeParse(formData.get("name"));
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    const [duplicate] = await db
      .select({ id: cashCategories.id })
      .from(cashCategories)
      .where(
        and(
          eq(cashCategories.name, parsed.data),
          ne(cashCategories.id, categoryId),
        ),
      )
      .limit(1);
    if (duplicate) {
      return { ok: false, error: "Ya existe una categoría con ese nombre." };
    }

    const [updated] = await db
      .update(cashCategories)
      .set({ name: parsed.data })
      .where(eq(cashCategories.id, categoryId))
      .returning({ id: cashCategories.id });
    if (!updated) return { ok: false, error: "La categoría no existe." };

    revalidateConfig();
    return { ok: true, message: "Categoría renombrada." };
  } catch (error) {
    return handleError(error);
  }
}

/** Categories are never deleted (§7.4): history keeps them; deactivation only
 * removes them from new entries. */
export async function setCategoryActiveAction(
  categoryId: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const [updated] = await db
      .update(cashCategories)
      .set({ isActive: active })
      .where(eq(cashCategories.id, categoryId))
      .returning({ name: cashCategories.name });
    if (!updated) return { ok: false, error: "La categoría no existe." };

    revalidateConfig();
    return {
      ok: true,
      message: active
        ? `Categoría "${updated.name}" reactivada.`
        : `Categoría "${updated.name}" desactivada. Los movimientos históricos la conservan.`,
    };
  } catch (error) {
    return handleError(error);
  }
}

// --- Users ------------------------------------------------------------------

const userCreateSchema = z.object({
  email: z.email({ error: "El email no es válido." }).toLowerCase(),
  name: z
    .string({ error: "El nombre es obligatorio." })
    .trim()
    .min(1, { error: "El nombre es obligatorio." })
    .max(80, { error: "El nombre admite hasta 80 caracteres." }),
  role: z.enum(["admin", "operator"], { error: "Elegí un rol." }),
});

// Runs on the caller's transaction so the last-admin check stays inside the
// USER_LIMIT_LOCK serialization (never on the global `db` connection).
async function countOtherActiveAdmins(
  tx: Tx,
  excludeUserId: string,
): Promise<number> {
  const [{ admins }] = await tx
    .select({ admins: count() })
    .from(users)
    .where(
      and(
        eq(users.role, "admin"),
        eq(users.isActive, true),
        // La cuenta de soporte NO cuenta como admin a estos efectos: si
        // contara, el cliente podria desactivar su unico admin visible y
        // quedarse sin administracion propia, con la UI diciendo que todo
        // esta bien porque hay un admin oculto.
        eq(users.isSupport, false),
        ne(users.id, excludeUserId),
      ),
    );
  return admins;
}

const SOPORTE_INTOCABLE = "El usuario no existe.";

export async function createUserAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const parsed = userCreateSchema.safeParse({
      email: formData.get("email"),
      name: formData.get("name"),
      role: formData.get("role"),
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const { email, name, role } = parsed.data;

    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      // Serializes the 5-active-users check against concurrent admins.
      await tx.execute(sql`select pg_advisory_xact_lock(${USER_LIMIT_LOCK})`);
      const [{ active }] = await tx
        .select({ active: count() })
        .from(users)
        .where(and(eq(users.isActive, true), eq(users.isSupport, false)));
      if (!canActivateUser(active)) {
        return { ok: false, error: USER_LIMIT_ERROR };
      }
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existing) {
        return {
          ok: false,
          error: `Ya existe un usuario con el email ${email}.`,
        };
      }
      await tx.insert(users).values({ email, name, role, passwordHash });
      return {
        ok: true,
        message: `Usuario ${email} creado.`,
        password, // shown ONCE in the UI; never stored in plain text
      };
    });

    if (result.ok) revalidateConfig();
    return result;
  } catch (error) {
    return handleError(error);
  }
}

export async function resetUserPasswordAction(
  userId: string,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const password = generatePassword();
    const passwordHash = await bcrypt.hash(password, 12);
    // Mismo mensaje que "no existe" a proposito: responder algo distinto
    // confirmaria que hay una cuenta oculta detras de ese id.
    const [updated] = await db
      .update(users)
      .set({ passwordHash })
      .where(and(eq(users.id, userId), eq(users.isSupport, false)))
      .returning({ email: users.email });
    if (!updated) return { ok: false, error: SOPORTE_INTOCABLE };

    return {
      ok: true,
      message: `Contraseña de ${updated.email} restablecida.`,
      password,
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function setUserActiveAction(
  userId: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    const admin = await requireRole("admin");
    if (!active && userId === admin.id) {
      return { ok: false, error: "No podés desactivarte a vos mismo." };
    }

    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      await tx.execute(sql`select pg_advisory_xact_lock(${USER_LIMIT_LOCK})`);
      const [target] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .for("update");
      if (!target || target.isSupport) {
        return { ok: false, error: SOPORTE_INTOCABLE };
      }

      if (active) {
        const [{ activeCount }] = await tx
          .select({ activeCount: count() })
          .from(users)
          .where(and(eq(users.isActive, true), eq(users.isSupport, false)));
        if (!target.isActive && !canActivateUser(activeCount)) {
          return { ok: false, error: USER_LIMIT_ERROR };
        }
      } else if (target.role === "admin") {
        const otherAdmins = await countOtherActiveAdmins(tx, userId);
        if (otherAdmins === 0) {
          return {
            ok: false,
            error: "No se puede desactivar al último administrador activo.",
          };
        }
      }

      await tx
        .update(users)
        .set({ isActive: active })
        .where(eq(users.id, userId));
      return {
        ok: true,
        message: active
          ? `Usuario ${target.email} reactivado.`
          : `Usuario ${target.email} desactivado. Su sesión expira en el próximo acceso.`,
      };
    });

    if (result.ok) revalidateConfig();
    return result;
  } catch (error) {
    return handleError(error);
  }
}

export async function setUserRoleAction(
  userId: string,
  role: "admin" | "operator",
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    if (role !== "admin" && role !== "operator") {
      return { ok: false, error: "Rol inválido." };
    }

    // Same lock as create/activate: the last-admin rule is a check-then-write
    // that must be serialized against every other user mutation.
    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      await tx.execute(sql`select pg_advisory_xact_lock(${USER_LIMIT_LOCK})`);
      const [target] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .for("update");
      if (!target || target.isSupport) {
        return { ok: false, error: SOPORTE_INTOCABLE };
      }

      if (target.role === "admin" && role === "operator" && target.isActive) {
        const otherAdmins = await countOtherActiveAdmins(tx, userId);
        if (otherAdmins === 0) {
          return {
            ok: false,
            error: "No se puede quitar el rol al último administrador activo.",
          };
        }
      }

      await tx.update(users).set({ role }).where(eq(users.id, userId));
      return { ok: true, message: `Rol de ${target.email} actualizado.` };
    });

    if (result.ok) revalidateConfig();
    return result;
  } catch (error) {
    return handleError(error);
  }
}

// --- Own password (both roles) ----------------------------------------------

export async function changeOwnPasswordAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const user = await requireRole();
    const parsed = z
      .object({
        current: z.string({ error: "Ingresá tu contraseña actual." }).min(1, {
          error: "Ingresá tu contraseña actual.",
        }),
        next: passwordSchema,
      })
      .safeParse({
        current: formData.get("current"),
        next: formData.get("next"),
      });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    const valid = await bcrypt.compare(parsed.data.current, user.passwordHash);
    if (!valid)
      return { ok: false, error: "La contraseña actual es incorrecta." };

    const passwordHash = await bcrypt.hash(parsed.data.next, 12);
    await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    return { ok: true, message: "Contraseña actualizada." };
  } catch (error) {
    return handleError(error);
  }
}

// --- Catalogo: categorias y subtipos de producto ----------------------------
//
// Listas cerradas: el cliente las administra desde aca y despues las elige de
// un selector al cargar un producto. Nunca texto libre.
//
// Como las categorias de dinero, NO se borran nunca: se desactivan. Un producto
// ya clasificado conserva su categoria; desactivar solo la saca de las opciones
// para clasificaciones nuevas.

/** El nombre tiene que dejar algo utilizable como URL. */
const catalogNameSchema = z
  .string({ error: "El nombre es obligatorio." })
  .trim()
  .min(1, { error: "El nombre es obligatorio." })
  .max(60, { error: "El nombre admite hasta 60 caracteres." })
  .refine((value) => slugify(value).length > 0, {
    error: "El nombre tiene que tener al menos una letra o un número.",
  });

export async function createProductCategoryAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const parsed = catalogNameSchema.safeParse(formData.get("name"));
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const name = parsed.data;

    const [dup] = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(eq(productCategories.name, name))
      .limit(1);
    if (dup)
      return { ok: false, error: "Ya existe una categoría con ese nombre." };

    const usados = await db
      .select({ slug: productCategories.slug })
      .from(productCategories);
    const [{ siguiente }] = await db
      .select({
        siguiente: sql<number>`coalesce(max(${productCategories.sortOrder}), 0) + 1`,
      })
      .from(productCategories);

    await db.insert(productCategories).values({
      name,
      slug: uniqueSlug(slugify(name), new Set(usados.map((u) => u.slug))),
      sortOrder: siguiente,
    });
    await revalidateCatalog();
    return { ok: true, message: `Categoría "${name}" creada.` };
  } catch (error) {
    return handleError(error);
  }
}

/** Renombrar cambia la etiqueta, NUNCA el slug: cambiarlo rompe los links ya
 * publicados de la web del cliente. */
export async function renameProductCategoryAction(
  categoryId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const parsed = catalogNameSchema.safeParse(formData.get("name"));
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    const [dup] = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(
        and(
          eq(productCategories.name, parsed.data),
          ne(productCategories.id, categoryId),
        ),
      )
      .limit(1);
    if (dup)
      return { ok: false, error: "Ya existe una categoría con ese nombre." };

    const [updated] = await db
      .update(productCategories)
      .set({ name: parsed.data })
      .where(eq(productCategories.id, categoryId))
      .returning({ id: productCategories.id });
    if (!updated) return { ok: false, error: "La categoría no existe." };

    await revalidateCatalog();
    return {
      ok: true,
      message: "Categoría renombrada. La dirección web no cambia.",
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function setProductCategoryActiveAction(
  categoryId: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const [updated] = await db
      .update(productCategories)
      .set({ isActive: active })
      .where(eq(productCategories.id, categoryId))
      .returning({ name: productCategories.name });
    if (!updated) return { ok: false, error: "La categoría no existe." };

    await revalidateCatalog();
    return {
      ok: true,
      message: active
        ? `Categoría "${updated.name}" reactivada.`
        : `Categoría "${updated.name}" desactivada. Los productos ya clasificados la conservan.`,
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function createProductSubtypeAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const parsed = z
      .object({
        categoryId: z.uuid({ error: "Elegí una categoría." }),
        name: catalogNameSchema,
      })
      .safeParse({
        categoryId: formData.get("categoryId"),
        name: formData.get("name"),
      });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const { categoryId, name } = parsed.data;

    const [category] = await db
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(eq(productCategories.id, categoryId))
      .limit(1);
    if (!category) return { ok: false, error: "La categoría no existe." };

    // Unico POR CATEGORIA: "De metal" puede existir bajo Mate y bajo Bombilla.
    const [dup] = await db
      .select({ id: productSubtypes.id })
      .from(productSubtypes)
      .where(
        and(
          eq(productSubtypes.categoryId, categoryId),
          eq(productSubtypes.name, name),
        ),
      )
      .limit(1);
    if (dup) {
      return {
        ok: false,
        error: "Esa categoría ya tiene un subtipo con ese nombre.",
      };
    }

    const usados = await db
      .select({ slug: productSubtypes.slug })
      .from(productSubtypes)
      .where(eq(productSubtypes.categoryId, categoryId));
    const [{ siguiente }] = await db
      .select({
        siguiente: sql<number>`coalesce(max(${productSubtypes.sortOrder}), 0) + 1`,
      })
      .from(productSubtypes)
      .where(eq(productSubtypes.categoryId, categoryId));

    await db.insert(productSubtypes).values({
      categoryId,
      name,
      slug: uniqueSlug(slugify(name), new Set(usados.map((u) => u.slug))),
      sortOrder: siguiente,
    });
    await revalidateCatalog();
    return { ok: true, message: `Subtipo "${name}" creado.` };
  } catch (error) {
    return handleError(error);
  }
}

export async function renameProductSubtypeAction(
  subtypeId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const parsed = catalogNameSchema.safeParse(formData.get("name"));
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    const [target] = await db
      .select({ categoryId: productSubtypes.categoryId })
      .from(productSubtypes)
      .where(eq(productSubtypes.id, subtypeId))
      .limit(1);
    if (!target) return { ok: false, error: "El subtipo no existe." };

    const [dup] = await db
      .select({ id: productSubtypes.id })
      .from(productSubtypes)
      .where(
        and(
          eq(productSubtypes.categoryId, target.categoryId),
          eq(productSubtypes.name, parsed.data),
          ne(productSubtypes.id, subtypeId),
        ),
      )
      .limit(1);
    if (dup) {
      return {
        ok: false,
        error: "Esa categoría ya tiene un subtipo con ese nombre.",
      };
    }

    await db
      .update(productSubtypes)
      .set({ name: parsed.data })
      .where(eq(productSubtypes.id, subtypeId));
    await revalidateCatalog();
    return {
      ok: true,
      message: "Subtipo renombrado. La dirección web no cambia.",
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function setProductSubtypeActiveAction(
  subtypeId: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const [updated] = await db
      .update(productSubtypes)
      .set({ isActive: active })
      .where(eq(productSubtypes.id, subtypeId))
      .returning({ name: productSubtypes.name });
    if (!updated) return { ok: false, error: "El subtipo no existe." };

    await revalidateCatalog();
    return {
      ok: true,
      message: active
        ? `Subtipo "${updated.name}" reactivado.`
        : `Subtipo "${updated.name}" desactivado. Los productos ya clasificados lo conservan.`,
    };
  } catch (error) {
    return handleError(error);
  }
}
