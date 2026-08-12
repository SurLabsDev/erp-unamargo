"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, requireRole } from "@/lib/auth-helpers";
import { db } from "@/lib/db/client";
import { BALANCE_LOCK } from "@/lib/db/locks";
import { cashCategories, cashMovements, settings } from "@/lib/db/schema";
import {
  cashMovementSchema,
  validateCashDate,
  voidReasonSchema,
} from "@/lib/domain/money";
import { todayInTimeZone } from "@/lib/format";

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

function handleError(error: unknown): ActionResult {
  if (error instanceof ForbiddenError) return { ok: false, error: error.message };
  console.error("[dinero:action]", error);
  return { ok: false, error: "Ocurrió un error, intentá de nuevo." };
}

function revalidateCash() {
  revalidatePath("/dinero");
  revalidatePath("/");
}

export async function createCashMovementAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const user = await requireRole(); // both roles create movements
    const parsed = cashMovementSchema.safeParse({
      date: formData.get("date"),
      kind: formData.get("kind"),
      categoryId: formData.get("categoryId"),
      concept: formData.get("concept"),
      amount: formData.get("amount"),
    });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const input = parsed.data;

    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      // Shared balance lock: concurrent movements don't block each other, but
      // the exclusive lock in updateBalanceSettingsAction can't move the cut
      // date between our date validation and the INSERT (§7.1 invariant).
      await tx.execute(sql`select pg_advisory_xact_lock_shared(${BALANCE_LOCK})`);
      const [instance] = await tx.select().from(settings).limit(1);
      if (!instance) return { ok: false, error: "La instancia no está configurada." };

      const dateError = validateCashDate(
        input.date,
        todayInTimeZone(instance.timezone),
        instance.initialBalanceDate,
      );
      if (dateError) return { ok: false, error: dateError };

      const [category] = await tx
        .select()
        .from(cashCategories)
        .where(eq(cashCategories.id, input.categoryId))
        .limit(1);
      if (!category || !category.isActive) {
        return { ok: false, error: "La categoría no existe o está inactiva." };
      }
      if (category.kind !== input.kind) {
        return {
          ok: false,
          error: "La categoría no corresponde al tipo de movimiento.",
        };
      }

      await tx.insert(cashMovements).values({
        date: input.date,
        kind: input.kind,
        categoryId: input.categoryId,
        concept: input.concept,
        amount: input.amount,
        createdBy: user.id,
      });
      return {
        ok: true,
        message:
          input.kind === "income" ? "Ingreso registrado." : "Egreso registrado.",
      };
    });

    if (result.ok) revalidateCash();
    return result;
  } catch (error) {
    return handleError(error);
  }
}

export async function voidCashMovementAction(
  movementId: number,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const user = await requireRole("admin"); // soft-void is admin-only
    const parsed = voidReasonSchema.safeParse(formData.get("reason"));
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    // Movements are never edited nor deleted: correction = void + re-entry.
    const [voided] = await db
      .update(cashMovements)
      .set({ voidedAt: new Date(), voidedBy: user.id, voidReason: parsed.data })
      .where(
        and(eq(cashMovements.id, movementId), isNull(cashMovements.voidedAt)),
      )
      .returning({ id: cashMovements.id });
    if (!voided) {
      return { ok: false, error: "El movimiento no existe o ya está anulado." };
    }

    revalidateCash();
    return { ok: true, message: "Movimiento anulado." };
  } catch (error) {
    return handleError(error);
  }
}
