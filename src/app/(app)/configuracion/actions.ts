"use server";

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, count, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import "@/lib/zod-locale";
import { ForbiddenError, requireRole } from "@/lib/auth-helpers";
import { db, type Tx } from "@/lib/db/client";
import { BALANCE_LOCK, USER_LIMIT_LOCK } from "@/lib/db/locks";
import { cashCategories, cashMovements, settings, users } from "@/lib/db/schema";
import { isValidISODate } from "@/lib/domain/dates";
import { categoryNameSchema, passwordSchema } from "@/lib/domain/money";
import { todayInTimeZone } from "@/lib/format";
import { getSettings } from "@/lib/settings";

export type ActionResult =
  | { ok: true; message: string; password?: string }
  | { ok: false; error: string };

const MAX_ACTIVE_USERS = 5;

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

function handleError(error: unknown): ActionResult {
  if (error instanceof ForbiddenError) return { ok: false, error: error.message };
  console.error("[configuracion:action]", error);
  return { ok: false, error: "Ocurrió un error, intentá de nuevo." };
}

function revalidateConfig() {
  revalidatePath("/configuracion");
  revalidatePath("/dinero");
  revalidatePath("/");
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

const recipientsSchema = z
  .array(z.email({ error: "Alguno de los emails no es válido." }))
  .max(3, { error: "Se admiten hasta 3 destinatarios." });

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
      .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
      .filter((value) => value !== "");
    const parsed = recipientsSchema.safeParse(raw);
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
        and(eq(cashCategories.name, parsed.data), ne(cashCategories.id, categoryId)),
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
        ne(users.id, excludeUserId),
      ),
    );
  return admins;
}

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
        .where(eq(users.isActive, true));
      if (active >= MAX_ACTIVE_USERS) {
        return {
          ok: false,
          error: `Límite alcanzado: la instancia admite hasta ${MAX_ACTIVE_USERS} usuarios activos.`,
        };
      }
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existing) {
        return { ok: false, error: `Ya existe un usuario con el email ${email}.` };
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
    const [updated] = await db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, userId))
      .returning({ email: users.email });
    if (!updated) return { ok: false, error: "El usuario no existe." };

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
      if (!target) return { ok: false, error: "El usuario no existe." };

      if (active) {
        const [{ activeCount }] = await tx
          .select({ activeCount: count() })
          .from(users)
          .where(eq(users.isActive, true));
        if (!target.isActive && activeCount >= MAX_ACTIVE_USERS) {
          return {
            ok: false,
            error: `Límite alcanzado: la instancia admite hasta ${MAX_ACTIVE_USERS} usuarios activos.`,
          };
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

      await tx.update(users).set({ isActive: active }).where(eq(users.id, userId));
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
      if (!target) return { ok: false, error: "El usuario no existe." };

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
    if (!valid) return { ok: false, error: "La contraseña actual es incorrecta." };

    const passwordHash = await bcrypt.hash(parsed.data.next, 12);
    await db.update(users).set({ passwordHash }).where(eq(users.id, user.id));
    return { ok: true, message: "Contraseña actualizada." };
  } catch (error) {
    return handleError(error);
  }
}
