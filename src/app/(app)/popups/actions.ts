"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import "@/lib/zod-locale";
import { ForbiddenError, requireRole } from "@/lib/auth-helpers";
import { avisarALaWeb } from "@/lib/avisar-web";
import { db } from "@/lib/db/client";
import { sitePopups } from "@/lib/db/schema";
import { popupInputSchema } from "@/lib/domain/popups";
import {
  deleteImage,
  storageConfigured,
  uploadPopupImage,
} from "@/lib/storage";

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const NOT_FOUND = "El pop-up no existe.";

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

function handleError(error: unknown): ActionResult {
  if (error instanceof ForbiddenError)
    return { ok: false, error: error.message };
  console.error("[popups:action]", error);
  return { ok: false, error: "Ocurrió un error, intentá de nuevo." };
}

/** Revalida las pantallas del ERP y, ademas, le avisa a la web publica, que
 *  es la que muestra los pop-ups. El aviso va aca adentro a proposito, igual
 *  que en `revalidateDiscounts`: TODA accion de este archivo que escribe pasa
 *  por aca, asi que una nueva lo hereda sin que nadie se acuerde de agregarlo.
 *  No toca la etiqueta del panel: el panel no muestra pop-ups. */
async function revalidatePopups(popupId?: string) {
  revalidatePath("/popups");
  if (popupId) revalidatePath(`/popups/${popupId}`);
  await avisarALaWeb();
}

/** El id llega del cliente: sin esto, uno mal formado viajaria a Postgres y
 *  volveria como error generico en vez de "no existe". */
function parseId(value: unknown): string | null {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parsePopupForm(formData: FormData) {
  return popupInputSchema.safeParse({
    title: formData.get("title") ?? "",
    body: formData.get("body") ?? "",
    ctaLabel: formData.get("ctaLabel") ?? "",
    ctaUrl: formData.get("ctaUrl") ?? "",
    startsOn: formData.get("startsOn") ?? "",
    endsOn: formData.get("endsOn") ?? "",
  });
}

/** Borra un objeto del bucket sin poder romper el guardado: la base ya se
 *  escribio, y un archivo huerfano en el bucket es invisible y barato. */
async function deleteImageQuietly(path: string): Promise<void> {
  try {
    await deleteImage(path);
  } catch (error) {
    console.error("[popups:delete-image]", path, error);
  }
}

// --- Pop-ups -----------------------------------------------------------------

export async function createPopupAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const admin = await requireRole("admin");
    const parsed = parsePopupForm(formData);
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const { title, body, ctaLabel, ctaUrl, startsOn, endsOn } = parsed.data;

    // `is_active` queda en su default, apagado (ver el schema): la imagen se
    // sube recien cuando la fila existe, y un pop-up encendido ya es publico.
    await db.insert(sitePopups).values({
      title,
      body,
      ctaLabel,
      ctaUrl,
      startsOn,
      endsOn,
      createdBy: admin.id,
    });

    await revalidatePopups();
    return {
      ok: true,
      message: `Pop-up "${title}" creado y apagado. Entrá en él para revisarlo y encenderlo.`,
    };
  } catch (error) {
    return handleError(error);
  }
}

export async function updatePopupAction(
  popupId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const id = parseId(popupId);
    if (!id) return { ok: false, error: NOT_FOUND };
    const parsed = parsePopupForm(formData);
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const { title, body, ctaLabel, ctaUrl, startsOn, endsOn } = parsed.data;

    const [updated] = await db
      .update(sitePopups)
      .set({
        title,
        body,
        ctaLabel,
        ctaUrl,
        startsOn,
        endsOn,
        updatedAt: new Date(),
      })
      .where(eq(sitePopups.id, id))
      .returning({ id: sitePopups.id });
    if (!updated) return { ok: false, error: NOT_FOUND };

    await revalidatePopups(id);
    return { ok: true, message: "Pop-up actualizado." };
  } catch (error) {
    return handleError(error);
  }
}

/** Pop-ups are never deleted, same as discount campaigns: this switches them
 * off and on. A real switch bumps `updated_at` like every other write, so
 * switching one on puts it in front of the other live ones (see `pickPopup`). */
export async function setPopupActiveAction(
  popupId: string,
  active: boolean,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const id = parseId(popupId);
    if (!id) return { ok: false, error: NOT_FOUND };
    // A server action is a public POST: the declared type is not a guarantee.
    if (typeof active !== "boolean") {
      return { ok: false, error: "Datos inválidos." };
    }

    // Writes only when the state actually changes. A click from a stale screen
    // (another tab, another admin) asking to switch on a pop-up that already
    // is would otherwise bump `updated_at`: it would jump back in front of the
    // ones edited since, and every visitor would get it again.
    const [changed] = await db
      .update(sitePopups)
      .set({ isActive: active, updatedAt: new Date() })
      .where(and(eq(sitePopups.id, id), ne(sitePopups.isActive, active)))
      .returning({ title: sitePopups.title });

    let title = changed?.title;
    if (title === undefined) {
      const [current] = await db
        .select({ title: sitePopups.title })
        .from(sitePopups)
        .where(eq(sitePopups.id, id))
        .limit(1);
      if (!current) return { ok: false, error: NOT_FOUND };
      title = current.title;
    }

    // Also when nothing changed: it refreshes the stale screen that asked.
    await revalidatePopups(id);
    const state = active ? "encendido" : "apagado";
    return {
      ok: true,
      message: changed
        ? `Pop-up "${title}" ${state}.`
        : `El pop-up "${title}" ya estaba ${state}.`,
    };
  } catch (error) {
    return handleError(error);
  }
}

// --- Imagen ------------------------------------------------------------------

/**
 * La imagen llega YA redimensionada por el navegador
 * (src/lib/redimensionar-imagen.ts), por el mismo camino y con los mismos
 * limites que las fotos de producto. En la practica el tope lo pone Next antes
 * que esto: corta el cuerpo de un server action en 1MB (next.config.ts no
 * cambia `serverActions.bodySizeLimit`), y una imagen achicada suele pesar unos
 * cientos de KB. Los 2MB de abajo son el limite de la app, igual que en stock.
 */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/webp", "image/jpeg", "image/png"];

/** Una sola imagen por pop-up: subir otra la reemplaza. */
export async function uploadPopupImageAction(
  popupId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    if (!storageConfigured()) {
      return {
        ok: false,
        error: "El almacenamiento de fotos no está configurado.",
      };
    }
    const id = parseId(popupId);
    if (!id) return { ok: false, error: NOT_FOUND };

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Elegí una imagen." };
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return { ok: false, error: "El formato tiene que ser WebP, JPG o PNG." };
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: "La imagen es demasiado grande." };
    }

    // Antes de subir nada: con un id que no existe, el archivo quedaria
    // huerfano en el bucket.
    const [exists] = await db
      .select({ id: sitePopups.id })
      .from(sitePopups)
      .where(eq(sitePopups.id, id))
      .limit(1);
    if (!exists) return { ok: false, error: NOT_FOUND };

    const upload = await uploadPopupImage({
      bytes: await file.arrayBuffer(),
      contentType: file.type,
    });
    if (!upload.ok) return { ok: false, error: upload.error };

    // La fila pasa a apuntar a la nueva DESPUES de que el objeto exista: al
    // reves, un fallo de subida dejaria la web con una imagen rota. La ruta
    // vieja se lee en la misma transaccion y con candado, para borrar la que
    // de verdad se reemplazo aunque dos admins suban a la vez.
    const replaced = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ imagePath: sitePopups.imagePath })
        .from(sitePopups)
        .where(eq(sitePopups.id, id))
        .for("update");
      if (!row) return null;
      await tx
        .update(sitePopups)
        .set({ imagePath: upload.path, updatedAt: new Date() })
        .where(eq(sitePopups.id, id));
      return { previousPath: row.imagePath };
    });
    if (!replaced) {
      await deleteImageQuietly(upload.path);
      return { ok: false, error: NOT_FOUND };
    }
    if (replaced.previousPath) await deleteImageQuietly(replaced.previousPath);

    await revalidatePopups(id);
    return { ok: true, message: "Imagen guardada." };
  } catch (error) {
    return handleError(error);
  }
}

export async function removePopupImageAction(
  popupId: string,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const id = parseId(popupId);
    if (!id) return { ok: false, error: NOT_FOUND };

    const removed = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ imagePath: sitePopups.imagePath })
        .from(sitePopups)
        .where(eq(sitePopups.id, id))
        .for("update");
      if (!row) return { found: false as const };
      if (row.imagePath === null) return { found: true as const, path: null };
      await tx
        .update(sitePopups)
        .set({ imagePath: null, updatedAt: new Date() })
        .where(eq(sitePopups.id, id));
      return { found: true as const, path: row.imagePath };
    });
    if (!removed.found) return { ok: false, error: NOT_FOUND };
    if (removed.path === null) {
      return { ok: false, error: "El pop-up no tiene imagen." };
    }

    // Primero la fila, despues el objeto, igual que las fotos de producto: si
    // el borrado falla queda un huerfano en el bucket (invisible y barato); al
    // reves quedaria una imagen rota en la web, que se ve.
    await deleteImageQuietly(removed.path);

    await revalidatePopups(id);
    return { ok: true, message: "Imagen quitada." };
  } catch (error) {
    return handleError(error);
  }
}
