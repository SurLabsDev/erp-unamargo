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
 * for the headers. It builds no public URL: nothing in this import needs one,
 * and `publicImageUrl` in that module is already the answer if anything ever
 * does.
 *
 * SUPABASE_SECRET_KEY BYPASSES RLS. Nothing in this file may ever be imported
 * from a client component, and nothing here prints or returns the key: the
 * error strings carry the status and the body Supabase sent back, never a
 * header.
 */

const BUCKET = "productos";

export type UploadResult = { ok: true } | { ok: false; error: string };

/**
 * Removes the secret key from anything that is about to be returned or printed.
 *
 * Not paranoia about our own strings: Node validates header VALUES and puts the
 * rejected value in the message it throws, so `error.message` from the fetch
 * below can contain the key verbatim. It takes a control character in the key to
 * get there, which will not happen -- and the key bypasses RLS, so the cost of
 * being wrong is the whole database and the fix is one line.
 */
function redact(text: string, key: string): string {
  return key === "" ? text : text.split(key).join("<clave oculta>");
}

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

  const encoded = input.bucketPath.split("/").map(encodeURIComponent).join("/");

  try {
    const res = await fetch(
      `${cfg.url}/storage/v1/object/${BUCKET}/${encoded}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.key}`,
          apikey: cfg.key,
          "Content-Type": input.contentType,
        },
        // `apikey` survives a cross-origin redirect, and this one bypasses RLS:
        // an unexpected redirect has to be loud instead of quietly followed.
        // (src/lib/storage.ts does not do this yet; it is out of scope here.)
        redirect: "error",
        // A Buffer is a Uint8Array, which fetch takes as a body directly.
        body: new Uint8Array(input.bytes),
      },
    );

    if (!res.ok) {
      // The body is not always JSON (the platform can answer with HTML when it
      // cuts the request), so it is read as text and truncated. INSIDE the try:
      // a body that cannot be read throws, and escaping from here would lose
      // which photo and which SKU it was and surface as a bare "terminated".
      const detail = (await res.text()).slice(0, 200);
      // Redacted like the branch below. Supabase has no reason to echo a
      // header back, but "no reason to" is not the same as "cannot".
      return {
        ok: false,
        error: `HTTP ${res.status}: ${redact(detail, cfg.key)}`,
      };
    }
    return { ok: true };
  } catch (error) {
    // A refused connection, a DNS failure, a redirect or a body that cannot be
    // read: none of them reach the branch above.
    const detail =
      error instanceof Error ? error.message || error.name : String(error);
    return {
      ok: false,
      error: `falló la subida al storage: ${redact(detail, cfg.key)}`,
    };
  }
}
