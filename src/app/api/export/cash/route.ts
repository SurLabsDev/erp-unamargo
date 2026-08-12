import { z } from "zod";
import { getCurrentUser } from "@/lib/auth-helpers";
import {
  buildCashCsv,
  cashCsvFilename,
  resolvePeriod,
} from "@/lib/domain/money";
import { todayInTimeZone } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { listCashForExport } from "@/app/(app)/dinero/queries";

// CSV export of the current period + active filters (§7.3). Session required:
// this is NOT a public endpoint (the proxy matcher also covers it).
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const settings = await getSettings();
  const url = new URL(request.url);
  const params = url.searchParams;

  const period = resolvePeriod(
    {
      preset: params.get("periodo") ?? undefined,
      fromISO: params.get("desde") ?? undefined,
      toISO: params.get("hasta") ?? undefined,
    },
    todayInTimeZone(settings.timezone),
  );

  const tipoParam = params.get("tipo");
  const categoriaParam = params.get("categoria");
  const rows = await listCashForExport(period, {
    kind: tipoParam === "income" || tipoParam === "expense" ? tipoParam : undefined,
    categoryId: z.uuid().safeParse(categoriaParam).success
      ? (categoriaParam as string)
      : undefined,
  });

  const csv = buildCashCsv(
    rows.map((row) => ({
      dateISO: row.date,
      kind: row.kind,
      categoryName: row.categoryName,
      concept: row.concept,
      amount: row.amount,
      userName: row.userName,
    })),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${cashCsvFilename(period)}"`,
      "Cache-Control": "no-store",
    },
  });
}
