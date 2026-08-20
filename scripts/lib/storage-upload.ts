/**
 * Uploading to the `productos` bucket from a script.
 *
 * Not `src/lib/storage.ts`: that module builds the object key itself (it only
 * ever knows a SKU) and this import has to choose the key, because
 * `--path-prefix` is what lets a rehearsal write under `_prueba/` and be wiped
 * afterwards. So this takes the full key and does nothing but the HTTP call.
 *
 * No `@supabase/supabase-js` here either: it is one POST and rule 6 of
 * AGENTS.md asks for no new dependencies. Same idiom as `src/lib/storage.ts`
 * for the headers and the public URL.
 *
 * SUPABASE_SECRET_KEY BYPASSES RLS. Nothing in this file may ever be imported
 * from a client component, and nothing here prints or returns the key: the
 * error strings carry the status and the body Supabase sent back, never a
 * header.
 */

const BUCKET = "productos";

export type UploadResult = { ok: true } | { ok: false; error: string };

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

/**
 * True when this environment can write to the bucket. The caller checks it
 * ONCE before the first product instead of discovering it 42 times: an import
 * that cannot upload has to stop before it starts, not halfway through the
 * client's catalog.
 */
export function storageConfigured(): boolean {
  return config() !== null;
}

/**
 * Public URL of an already uploaded object. Each segment is encoded because the
 * keys carry a SKU, and a key that needed encoding would be stored under one
 * name and published under another.
 */
export function publicObjectUrl(bucketPath: string): string {
  const cfg = config();
  if (!cfg) return "";
  const encoded = bucketPath.split("/").map(encodeURIComponent).join("/");
  return `${cfg.url}/storage/v1/object/public/${BUCKET}/${encoded}`;
}

/**
 * Uploads the bytes under `bucketPath`, exactly as given.
 *
 * No `x-upsert`, so the key is created or the call fails: every key this import
 * writes carries a fresh uuid, and a 409 would mean two runs collided, which is
 * worth a loud failure rather than a silent overwrite.
 */
export async function uploadFile(input: {
  bucketPath: string;
  bytes: Buffer;
  contentType: string;
}): Promise<UploadResult> {
  const cfg = config();
  if (!cfg) {
    return {
      ok: false,
      error:
        "faltan SUPABASE_URL o SUPABASE_SECRET_KEY: sin ellas no se puede subir ninguna foto.",
    };
  }

  const encoded = input.bucketPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  let res: Response;
  try {
    res = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${encoded}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        apikey: cfg.key,
        "Content-Type": input.contentType,
      },
      // A Buffer is a Uint8Array, which fetch takes as a body directly.
      body: new Uint8Array(input.bytes),
    });
  } catch (error) {
    // A refused connection or a DNS failure never reaches the branch below.
    return {
      ok: false,
      error: `no se pudo conectar con el storage: ${
        error instanceof Error ? error.message || error.name : String(error)
      }`,
    };
  }

  if (!res.ok) {
    // The body is not always JSON (the platform can answer with HTML when it
    // cuts the request), so it is read as text and truncated.
    const detail = (await res.text()).slice(0, 200);
    return { ok: false, error: `HTTP ${res.status}: ${detail}` };
  }
  return { ok: true };
}
