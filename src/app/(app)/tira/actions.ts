"use server";

import { count, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import "@/lib/zod-locale";
import { ForbiddenError, requireRole } from "@/lib/auth-helpers";
import { avisarALaWeb } from "@/lib/avisar-web";
import { db } from "@/lib/db/client";
// Serializes the writes that depend on the count and the order of the strip
// (upload and move): a plain COUNT has a race between two tabs or two admins.
import { STRIP_PHOTOS_LOCK } from "@/lib/db/locks";
import { siteStripPhotos } from "@/lib/db/schema";
import {
  STRIP_LIMIT_ERROR,
  canAddStripPhoto,
  isStripMoveDirection,
  moveStripPhoto,
  nextStripSortOrder,
  stripAltSchema,
  type StripMoveDirection,
} from "@/lib/domain/strip";
import { readImageInfo } from "@/lib/image-size";
import {
  deleteImage,
  storageConfigured,
  uploadStripImage,
} from "@/lib/storage";

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

const NOT_FOUND = "La foto no existe.";

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

function handleError(error: unknown): ActionResult {
  if (error instanceof ForbiddenError)
    return { ok: false, error: error.message };
  console.error("[strip:action]", error);
  return { ok: false, error: "Ocurrió un error, intentá de nuevo." };
}

/** Revalida la pantalla de la tira y, ademas, le avisa a la web publica, que
 *  es la que muestra las fotos. El aviso va aca adentro a proposito, igual que
 *  en `revalidatePopups`: TODA accion de este archivo que escribe pasa por
 *  aca, asi que una nueva lo hereda sin que nadie se acuerde de agregarlo. */
async function revalidateStrip() {
  revalidatePath("/tira");
  await avisarALaWeb();
}

/** El id llega del cliente: sin esto, uno mal formado viajaria a Postgres y
 *  volveria como error generico en vez de "no existe". */
function parseId(value: unknown): string | null {
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Borra un objeto del bucket sin poder romper la accion: la base ya se
 *  escribio, y un archivo huerfano en el bucket es invisible y barato. */
async function deleteImageQuietly(path: string): Promise<void> {
  try {
    await deleteImage(path);
  } catch (error) {
    console.error("[strip:delete-image]", path, error);
  }
}

// --- Subida ------------------------------------------------------------------

/**
 * Una foto por llamada: el navegador las sube de a una porque Next corta el
 * cuerpo de un server action en 1MB, y cada una llega YA achicada por
 * src/lib/redimensionar-imagen.ts, como las fotos de producto. Los 2MB de
 * abajo son el limite de la app, igual que en stock y en pop-ups.
 */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/webp", "image/jpeg", "image/png"];

export async function uploadStripPhotoAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const admin = await requireRole("admin");
    if (!storageConfigured()) {
      return {
        ok: false,
        error: "El almacenamiento de fotos no está configurado.",
      };
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Elegí una foto." };
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return { ok: false, error: "El formato tiene que ser WebP, JPG o PNG." };
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: "La foto es demasiado grande." };
    }

    // Ancho y alto salen de los bytes que se van a guardar, nunca del
    // formulario: la web arma la tira con estas medidas, y tienen que ser las
    // de la foto que de verdad va a servir, la ya achicada.
    const bytes = await file.arrayBuffer();
    const info = readImageInfo(new Uint8Array(bytes));
    if (!info) {
      return {
        ok: false,
        error: "No se pudo leer la foto. Probá con JPG o PNG.",
      };
    }

    // Antes de subir nada: con la tira llena, el archivo solo se subiria para
    // borrarlo. El conteo que manda es el de abajo, con candado.
    const [{ total }] = await db
      .select({ total: count() })
      .from(siteStripPhotos);
    if (!canAddStripPhoto(total)) return { ok: false, error: STRIP_LIMIT_ERROR };

    // Con el tipo LEIDO de los bytes, no el declarado: un navegador que no
    // sabe hacer WebP puede mandar un PNG con la etiqueta de WebP.
    const upload = await uploadStripImage({ bytes, contentType: info.type });
    if (!upload.ok) return { ok: false, error: upload.error };

    // La fila va DESPUES de que el objeto exista: al reves, un fallo de subida
    // dejaria la web con una foto rota. Cuantas hay y en que lugar va la nueva
    // se leen con candado: sin el, dos subidas a la vez (dos pestañas, dos
    // admins) verian 19 las dos y dejarian 21, o tomarian el mismo lugar.
    const inserted = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${STRIP_PHOTOS_LOCK})`);
      const rows = await tx
        .select({ sortOrder: siteStripPhotos.sortOrder })
        .from(siteStripPhotos);
      if (!canAddStripPhoto(rows.length)) return false;
      await tx.insert(siteStripPhotos).values({
        imagePath: upload.path,
        width: info.width,
        height: info.height,
        sortOrder: nextStripSortOrder(rows),
        createdBy: admin.id,
      });
      return true;
    });
    if (!inserted) {
      // Solo aca se borra lo subido: la transaccion confirmo SIN insertar. Si
      // tirara un error no se borra, porque un COMMIT que llego a la base pero
      // no volvio dejaria la fila apuntando a nada: una foto rota en la web.
      await deleteImageQuietly(upload.path);
      return { ok: false, error: STRIP_LIMIT_ERROR };
    }

    await revalidateStrip();
    return { ok: true, message: "Foto agregada a la tira." };
  } catch (error) {
    return handleError(error);
  }
}

// --- Orden -------------------------------------------------------------------

/** Sube o baja una foto un lugar. Se mueve de a uno y no con un numero, como
 *  los estantes de la tienda: nadie piensa "esta va en el 7". */
export async function moveStripPhotoAction(
  photoId: string,
  direction: StripMoveDirection,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const id = parseId(photoId);
    if (!id) return { ok: false, error: NOT_FOUND };
    // A server action is a public POST: the declared type is not a guarantee.
    if (!isStripMoveDirection(direction)) {
      return { ok: false, error: "Datos inválidos." };
    }

    const result = await db.transaction(async (tx): Promise<ActionResult> => {
      await tx.execute(sql`select pg_advisory_xact_lock(${STRIP_PHOTOS_LOCK})`);
      const rows = await tx
        .select({
          id: siteStripPhotos.id,
          sortOrder: siteStripPhotos.sortOrder,
          createdAt: siteStripPhotos.createdAt,
        })
        .from(siteStripPhotos);

      const move = moveStripPhoto(rows, id, direction);
      if (!move.ok) {
        if (move.reason === "not-found") return { ok: false, error: NOT_FOUND };
        return {
          ok: false,
          error:
            direction === "up"
              ? "La foto ya es la primera."
              : "La foto ya es la última.",
        };
      }

      const now = new Date();
      for (const change of move.changes) {
        await tx
          .update(siteStripPhotos)
          .set({ sortOrder: change.sortOrder, updatedAt: now })
          .where(eq(siteStripPhotos.id, change.id));
      }
      return { ok: true, message: "Orden actualizado." };
    });

    if (result.ok) await revalidateStrip();
    return result;
  } catch (error) {
    return handleError(error);
  }
}

// --- Descripcion -------------------------------------------------------------

export async function updateStripPhotoAltAction(
  photoId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const id = parseId(photoId);
    if (!id) return { ok: false, error: NOT_FOUND };
    const parsed = stripAltSchema.safeParse(formData.get("alt") ?? "");
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

    const [updated] = await db
      .update(siteStripPhotos)
      .set({ alt: parsed.data, updatedAt: new Date() })
      .where(eq(siteStripPhotos.id, id))
      .returning({ id: siteStripPhotos.id });
    if (!updated) return { ok: false, error: NOT_FOUND };

    await revalidateStrip();
    return {
      ok: true,
      message:
        parsed.data === null ? "Descripción borrada." : "Descripción guardada.",
    };
  } catch (error) {
    return handleError(error);
  }
}

// --- Quitar ------------------------------------------------------------------

export async function deleteStripPhotoAction(
  photoId: string,
): Promise<ActionResult> {
  try {
    await requireRole("admin");
    const id = parseId(photoId);
    if (!id) return { ok: false, error: NOT_FOUND };

    // Primero la fila, despues el objeto, igual que las fotos de producto: si
    // el borrado del archivo falla queda un huerfano en el bucket (invisible y
    // barato); al reves quedaria una foto rota corriendo en la web, que se ve.
    // El hueco que deja en el orden no molesta: el orden es relativo.
    const [removed] = await db
      .delete(siteStripPhotos)
      .where(eq(siteStripPhotos.id, id))
      .returning({ imagePath: siteStripPhotos.imagePath });
    if (!removed) return { ok: false, error: NOT_FOUND };

    await deleteImageQuietly(removed.imagePath);

    await revalidateStrip();
    return { ok: true, message: "Foto quitada de la tira." };
  } catch (error) {
    return handleError(error);
  }
}
