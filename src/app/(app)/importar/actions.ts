"use server";

import { revalidatePath } from "next/cache";
import { deliverAlerts } from "@/lib/alerts";
import { ForbiddenError, requireRole } from "@/lib/auth-helpers";
import { parseProductsCsv } from "@/lib/domain/import";
import { executeImport, previewImport } from "@/lib/import-runner";

const MAX_FILE_BYTES = 512 * 1024;

export type PreviewRow = {
  line: number;
  sku: string;
  name: string;
  stock: number | null;
  minStock: number | null;
  status: "ok" | "error";
  reason?: string;
};

export type PreviewResult =
  | {
      ok: true;
      rows: PreviewRow[];
      validCount: number;
      rejectedCount: number;
    }
  | { ok: false; error: string };

export type ConfirmResult =
  | {
      ok: true;
      message: string;
      created: number;
      rejected: Array<{ line: number; sku: string; reason: string }>;
    }
  | { ok: false; error: string };

async function readCsvFile(
  formData: FormData,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Elegí un archivo CSV." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: "El archivo supera los 512 KB." };
  }
  return { ok: true, text: await file.text() };
}

export async function previewImportAction(
  formData: FormData,
): Promise<PreviewResult> {
  try {
    await requireRole("admin");
    const read = await readCsvFile(formData);
    if (!read.ok) return read;

    const parsed = parseProductsCsv(read.text);
    if (!parsed.ok) return { ok: false, error: parsed.fileError };

    const { creatable, rejected: dbRejected } = await previewImport(
      parsed.rows,
    );
    const rowsBySku = new Map(parsed.rows.map((row) => [`${row.line}`, row]));

    const rows: PreviewRow[] = [
      ...creatable.map<PreviewRow>((row) => ({
        line: row.line,
        sku: row.sku,
        name: row.name,
        stock: row.stock,
        minStock: row.minStock,
        status: "ok",
      })),
      ...parsed.rejected.map<PreviewRow>((row) => ({
        line: row.line,
        sku: row.sku,
        name: "",
        stock: null,
        minStock: null,
        status: "error",
        reason: row.reason,
      })),
      ...dbRejected.map<PreviewRow>((row) => {
        const source = rowsBySku.get(`${row.line}`);
        return {
          line: row.line,
          sku: row.sku,
          name: source?.name ?? "",
          stock: source?.stock ?? null,
          minStock: source?.minStock ?? null,
          status: "error",
          reason: row.reason,
        };
      }),
    ].sort((a, b) => a.line - b.line);

    return {
      ok: true,
      rows,
      validCount: creatable.length,
      rejectedCount: rows.length - creatable.length,
    };
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { ok: false, error: error.message };
    console.error("[importar:preview]", error);
    return { ok: false, error: "Ocurrió un error, intentá de nuevo." };
  }
}

export async function confirmImportAction(
  formData: FormData,
): Promise<ConfirmResult> {
  try {
    const user = await requireRole("admin");
    const read = await readCsvFile(formData);
    if (!read.ok) return read;

    // The file is re-parsed and re-validated here under the lock: the preview
    // is informative, the confirm step is the source of truth.
    const parsed = parseProductsCsv(read.text);
    if (!parsed.ok) return { ok: false, error: parsed.fileError };

    const outcome = await executeImport(user.id, parsed.rows);
    // §8.6: ONE summary email for the whole batch, after commit.
    await deliverAlerts(outcome.pendings);

    revalidatePath("/stock");
    revalidatePath("/");

    const rejected = [...parsed.rejected, ...outcome.rejected].sort(
      (a, b) => a.line - b.line,
    );
    return {
      ok: true,
      message: `Importación completa: ${outcome.created} producto(s) creado(s), ${rejected.length} rechazado(s).`,
      created: outcome.created,
      rejected,
    };
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { ok: false, error: error.message };
    console.error("[importar:confirm]", error);
    return { ok: false, error: "Ocurrió un error, intentá de nuevo." };
  }
}
