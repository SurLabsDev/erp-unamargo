/**
 * Fotos de producto en Supabase Storage, bucket `productos`.
 *
 * Sin `@supabase/supabase-js`: son tres llamadas HTTP y la regla 6 del
 * AGENTS.md pide no sumar dependencias sin justificacion. La secret key saltea
 * RLS, asi que este modulo es SOLO de servidor: nada de lo de aca puede
 * terminar en un componente cliente.
 */
import { randomUUID } from "node:crypto";

const BUCKET = "productos";

export type StorageResult =
  { ok: true; path: string } | { ok: false; error: string };

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

/** True cuando la instancia tiene storage configurado. La UI oculta la subida
 * si es false, en vez de ofrecer un boton que falla. */
export function storageConfigured(): boolean {
  return config() !== null;
}

/** URL publica y estable de una foto ya subida. */
export function publicImageUrl(path: string): string {
  const cfg = config();
  if (!cfg) return "";
  return `${cfg.url}/storage/v1/object/public/${BUCKET}/${path}`;
}

/**
 * Sube los bytes y devuelve la ruta guardada.
 * El nombre lleva un uuid y jamas se reutiliza (ver el comentario de
 * `productImages` en el schema: el CDN de Supabase cachea las URLs publicas).
 */
export async function uploadProductImage(input: {
  sku: string;
  bytes: ArrayBuffer;
  contentType: string;
}): Promise<StorageResult> {
  const cfg = config();
  if (!cfg)
    return {
      ok: false,
      error: "El almacenamiento de fotos no está configurado.",
    };

  const ext =
    input.contentType === "image/png"
      ? "png"
      : input.contentType === "image/jpeg"
        ? "jpg"
        : "webp";
  // El SKU solo da legibilidad al navegar el bucket; la unicidad la da el uuid.
  const carpeta =
    input.sku.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40) || "sin-sku";
  const path = `${carpeta}/${randomUUID()}.${ext}`;

  const res = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      apikey: cfg.key,
      "Content-Type": input.contentType,
    },
    body: input.bytes,
  });
  if (!res.ok) {
    // El cuerpo puede no ser JSON cuando corta la plataforma: leer texto.
    const detalle = (await res.text()).slice(0, 200);
    console.error("[storage:upload]", res.status, detalle);
    return { ok: false, error: "No se pudo subir la foto. Probá de nuevo." };
  }
  return { ok: true, path };
}

/** Borra el objeto. Si falla, el llamador decide: dejar la fila huerfana es
 * peor que dejar un archivo huerfano. */
export async function deleteProductImage(path: string): Promise<boolean> {
  const cfg = config();
  if (!cfg) return false;
  const res = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${cfg.key}`, apikey: cfg.key },
  });
  if (!res.ok) console.error("[storage:delete]", res.status, path);
  return res.ok;
}
