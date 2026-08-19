"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import "@/lib/zod-locale";
import { ForbiddenError, requireRole } from "@/lib/auth-helpers";
import { db } from "@/lib/db/client";
import { discountCampaigns, discountTargets } from "@/lib/db/schema";
import { isValidISODate } from "@/lib/domain/dates";
import { MAX_PERCENTAGE, MIN_PERCENTAGE } from "@/lib/domain/discounts";

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

function handleError(error: unknown): ActionResult {
  if (error instanceof ForbiddenError)
    return { ok: false, error: error.message };
  console.error("[descuentos:action]", error);
  return { ok: false, error: "Ocurrió un error, intentá de nuevo." };
}

function revalidateDiscounts() {
  revalidatePath("/descuentos");
  revalidatePath("/stock");
  revalidatePath("/");
}

// --- Campaigns ---------------------------------------------------------------

const campaignSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { error: "El nombre es obligatorio." })
      .max(80, { error: "El nombre admite hasta 80 caracteres." }),
    percentage: z.coerce
      .number()
      .int()
      .min(MIN_PERCENTAGE, {
        error: `El descuento va de ${MIN_PERCENTAGE}% a ${MAX_PERCENTAGE}%.`,
      })
      .max(MAX_PERCENTAGE, {
        error: `El descuento va de ${MIN_PERCENTAGE}% a ${MAX_PERCENTAGE}%.`,
      }),
    startsOn: z
      .string()
      .refine(isValidISODate, { error: "La fecha de inicio no es válida." }),
    endsOn: z
      .string()
      .refine(isValidISODate, { error: "La fecha de fin no es válida." }),
  })
  .refine((v) => v.endsOn >= v.startsOn, {
    error: "La fecha de fin no puede ser anterior a la de inicio.",
  });

function parseCampaignForm(formData: FormData) {
  return campaignSchema.safeParse({
    name: formData.get("name"),
    percentage: formData.get("percentage"),
    startsOn: formData.get("startsOn"),
    endsOn: formData.get("endsOn"),
  });
}

export async function createCampaignAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const admin = await requireRole("admin");
    const parsed = parseCampaignForm(formData);
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const { name, percentage, startsOn, endsOn } = parsed.data;

    await db.insert(discountCampaigns).values({
      name,
      percentage,
      startsOn,
      endsOn,
      createdBy: admin.id,
    });

    revalidateDiscounts();
    return { ok: true, message: `Campaña "${name}" creada.` };
  } catch (error) {
    return handleError(error);
  }
}

export async function updateCampaignAction(
  campaignId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const parsed = parseCampaignForm(formData);
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const { name, percentage, startsOn, endsOn } = parsed.data;

    const [updated] = await db
      .update(discountCampaigns)
      .set({ name, percentage, startsOn, endsOn, updatedAt: new Date() })
      .where(eq(discountCampaigns.id, campaignId))
      .returning({ id: discountCampaigns.id });
    if (!updated) return { ok: false, error: "La campaña no existe." };

    revalidateDiscounts();
    return { ok: true, message: "Campaña actualizada." };
  } catch (error) {
    return handleError(error);
  }
}

/** Campaigns are never deleted, same as `cash_categories` and
 * `product_categories`: this pauses and reactivates instead. */
export async function setCampaignActiveAction(
  campaignId: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const [updated] = await db
      .update(discountCampaigns)
      .set({ isActive: active, updatedAt: new Date() })
      .where(eq(discountCampaigns.id, campaignId))
      .returning({ name: discountCampaigns.name });
    if (!updated) return { ok: false, error: "La campaña no existe." };

    revalidateDiscounts();
    return {
      ok: true,
      message: active
        ? `Campaña "${updated.name}" reactivada.`
        : `Campaña "${updated.name}" pausada.`,
    };
  } catch (error) {
    return handleError(error);
  }
}

// --- Targets -------------------------------------------------------------

const TARGET_LEVELS = ["product", "subtype", "category"] as const;
type TargetLevel = (typeof TARGET_LEVELS)[number];

const targetColumns = {
  product: discountTargets.productId,
  subtype: discountTargets.subtypeId,
  category: discountTargets.categoryId,
};

function nonEmpty(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Adds one target to a campaign. Accepts `campaignId` plus EXACTLY ONE of
 * `productId`, `subtypeId`, `categoryId`; more than one or none is rejected
 * here, before the database is touched. The `discount_targets_exactly_one_check`
 * CHECK constraint is the safety net, not the primary validation.
 */
export async function addTargetAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole("admin");

    const campaignIdParsed = z
      .uuid({ error: "La campaña no existe." })
      .safeParse(formData.get("campaignId"));
    if (!campaignIdParsed.success) {
      return { ok: false, error: "La campaña no existe." };
    }
    const campaignId = campaignIdParsed.data;

    const rawByLevel: Record<TargetLevel, string | null> = {
      product: nonEmpty(formData.get("productId")),
      subtype: nonEmpty(formData.get("subtypeId")),
      category: nonEmpty(formData.get("categoryId")),
    };
    const providedLevels = TARGET_LEVELS.filter(
      (level) => rawByLevel[level] !== null,
    );
    if (providedLevels.length !== 1) {
      return { ok: false, error: "Elegí un solo objetivo." };
    }
    const level = providedLevels[0];

    const targetIdParsed = z
      .uuid({ error: "Identificador inválido." })
      .safeParse(rawByLevel[level]);
    if (!targetIdParsed.success) {
      return { ok: false, error: "Identificador inválido." };
    }
    const targetId = targetIdParsed.data;

    const [campaign] = await db
      .select({ id: discountCampaigns.id })
      .from(discountCampaigns)
      .where(eq(discountCampaigns.id, campaignId))
      .limit(1);
    if (!campaign) return { ok: false, error: "La campaña no existe." };

    const [duplicate] = await db
      .select({ id: discountTargets.id })
      .from(discountTargets)
      .where(
        and(
          eq(discountTargets.campaignId, campaignId),
          eq(targetColumns[level], targetId),
        ),
      )
      .limit(1);
    if (duplicate) {
      return { ok: false, error: "Ese objetivo ya está en la campaña." };
    }

    await db.insert(discountTargets).values({
      campaignId,
      productId: level === "product" ? targetId : null,
      subtypeId: level === "subtype" ? targetId : null,
      categoryId: level === "category" ? targetId : null,
    });

    revalidateDiscounts();
    return { ok: true, message: "Objetivo agregado a la campaña." };
  } catch (error) {
    return handleError(error);
  }
}

export async function removeTargetAction(
  targetId: string,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const [deleted] = await db
      .delete(discountTargets)
      .where(eq(discountTargets.id, targetId))
      .returning({ id: discountTargets.id });
    if (!deleted) return { ok: false, error: "El objetivo no existe." };

    revalidateDiscounts();
    return { ok: true, message: "Objetivo quitado de la campaña." };
  } catch (error) {
    return handleError(error);
  }
}
