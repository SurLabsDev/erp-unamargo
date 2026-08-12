import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { PaginationLinks } from "@/components/pagination-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireUser } from "@/lib/auth-helpers";
import {
  CASH_KIND_LABELS,
  computePeriodSummary,
  resolvePeriod,
  type Period,
} from "@/lib/domain/money";
import { formatDate, formatMoney, todayInTimeZone } from "@/lib/format";
import { parsePageParam, singleParam } from "@/lib/params";
import { getSettings } from "@/lib/settings";
import { NewCashMovementButton } from "./cash-movement-dialog";
import { CashTable } from "./cash-table";
import {
  categoryBreakdown,
  listCashMovements,
  listCategories,
  periodTotals,
  type CashFilters,
} from "./queries";

export const metadata: Metadata = { title: "Dinero" };

const selectClassName =
  "border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

function periodQuery(period: Period): URLSearchParams {
  const params = new URLSearchParams();
  params.set("periodo", period.preset);
  if (period.preset === "custom") {
    params.set("desde", period.fromISO);
    params.set("hasta", period.toISO);
  }
  return params;
}

export default async function DineroPage(props: PageProps<"/dinero">) {
  const user = await requireUser();
  const settings = await getSettings();
  const todayISO = todayInTimeZone(settings.timezone);
  const searchParams = await props.searchParams;

  const period = resolvePeriod(
    {
      preset: singleParam(searchParams.periodo),
      fromISO: singleParam(searchParams.desde),
      toISO: singleParam(searchParams.hasta),
    },
    todayISO,
  );

  const tipoParam = singleParam(searchParams.tipo);
  const categoriaParam = singleParam(searchParams.categoria);
  const filters: CashFilters = {
    kind:
      tipoParam === "income" || tipoParam === "expense" ? tipoParam : undefined,
    categoryId: z.uuid().safeParse(categoriaParam).success
      ? categoriaParam
      : undefined,
    includeVoided: singleParam(searchParams.anulados) === "1",
    page: parsePageParam(searchParams.page),
  };

  const [totals, breakdown, movements, categories] = await Promise.all([
    periodTotals(period),
    categoryBreakdown(period),
    listCashMovements(period, filters),
    listCategories(),
  ]);
  const summary = computePeriodSummary(settings.initialBalance, totals);
  const currency = settings.currencyCode;

  const withFilters = (params: URLSearchParams) => {
    if (filters.kind) params.set("tipo", filters.kind);
    if (filters.categoryId) params.set("categoria", filters.categoryId);
    if (filters.includeVoided) params.set("anulados", "1");
    return params;
  };

  const presetHref = (preset: "mes" | "mes-anterior" | "30-dias") => {
    const params = withFilters(new URLSearchParams());
    params.set("periodo", preset);
    return `/dinero?${params.toString()}`;
  };

  const hrefForPage = (page: number) => {
    const params = withFilters(periodQuery(period));
    if (page > 1) params.set("page", String(page));
    return `/dinero?${params.toString()}`;
  };

  const exportHref = `/api/export/cash?${withFilters(periodQuery(period)).toString()}`;

  const summaryItems = [
    { label: "Saldo al inicio", value: summary.openingBalance },
    { label: "Ingresos", value: summary.income, sign: "+" },
    { label: "Egresos", value: summary.expense, sign: "−" },
    { label: "Resultado", value: summary.result },
    { label: "Saldo al cierre", value: summary.closingBalance, strong: true },
  ];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Dinero"
          description="Control interno. No reemplaza la contabilidad formal."
        />
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={exportHref}>
              <Download className="size-4" />
              Exportar CSV
            </a>
          </Button>
          <NewCashMovementButton
            categories={categories
              .filter((c) => c.isActive)
              .map(({ id, name, kind }) => ({ id, name, kind }))}
            todayISO={todayISO}
            minDateISO={settings.initialBalanceDate}
          />
        </div>
      </div>

      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
        {(
          [
            ["mes", "Mes actual"],
            ["mes-anterior", "Mes anterior"],
            ["30-dias", "Últimos 30 días"],
          ] as const
        ).map(([preset, label]) => (
          <Button
            key={preset}
            asChild
            size="sm"
            variant={period.preset === preset ? "default" : "outline"}
          >
            <Link href={presetHref(preset)}>{label}</Link>
          </Button>
        ))}
        <form method="GET" className="ml-auto flex flex-wrap items-center gap-2">
          <input type="hidden" name="periodo" value="custom" />
          {filters.kind ? (
            <input type="hidden" name="tipo" value={filters.kind} />
          ) : null}
          {filters.categoryId ? (
            <input type="hidden" name="categoria" value={filters.categoryId} />
          ) : null}
          {filters.includeVoided ? (
            <input type="hidden" name="anulados" value="1" />
          ) : null}
          <Input
            type="date"
            name="desde"
            defaultValue={period.preset === "custom" ? period.fromISO : ""}
            aria-label="Desde"
            className="w-auto"
            required
          />
          <span className="text-xs text-muted-foreground">a</span>
          <Input
            type="date"
            name="hasta"
            defaultValue={period.preset === "custom" ? period.toISO : ""}
            aria-label="Hasta"
            className="w-auto"
            required
          />
          <Button
            type="submit"
            size="sm"
            variant={period.preset === "custom" ? "default" : "outline"}
          >
            Aplicar
          </Button>
        </form>
      </div>

      {/* §7.2: the five period numbers */}
      <dl className="grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-3 lg:grid-cols-5">
        {summaryItems.map((item) => (
          <div key={item.label}>
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd
              className={`tabular-nums ${item.strong ? "text-xl font-semibold" : "text-lg font-medium"}`}
            >
              {"sign" in item && item.sign ? item.sign : ""}
              {formatMoney(item.value, currency)}
            </dd>
          </div>
        ))}
        <p className="col-span-full text-xs text-muted-foreground">
          Período: {formatDate(period.fromISO)} a {formatDate(period.toISO)} ·
          Saldo inicial de la instancia:{" "}
          {formatMoney(settings.initialBalance, currency)} al{" "}
          {formatDate(settings.initialBalanceDate)}
        </p>
      </dl>

      {/* Category breakdown */}
      {breakdown.length > 0 ? (
        <div className="grid gap-2 rounded-lg border p-4 sm:grid-cols-2">
          {(["income", "expense"] as const).map((kind) => {
            const rows = breakdown.filter((row) => row.kind === kind);
            if (rows.length === 0) return null;
            return (
              <div key={kind} className="grid gap-1">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {CASH_KIND_LABELS[kind]}s por categoría
                </h3>
                <ul className="grid gap-1">
                  {rows.map((row) => (
                    <li
                      key={`${kind}-${row.categoryName}`}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="truncate">{row.categoryName}</span>
                      <span className="tabular-nums">
                        {formatMoney(row.total, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* List filters */}
      <form
        method="GET"
        className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
      >
        <input type="hidden" name="periodo" value={period.preset} />
        {period.preset === "custom" ? (
          <>
            <input type="hidden" name="desde" value={period.fromISO} />
            <input type="hidden" name="hasta" value={period.toISO} />
          </>
        ) : null}
        <div className="grid gap-1">
          <Label className="text-xs">Tipo</Label>
          <select
            name="tipo"
            defaultValue={filters.kind ?? ""}
            className={selectClassName}
            aria-label="Tipo"
          >
            <option value="">Todos</option>
            <option value="income">Ingresos</option>
            <option value="expense">Egresos</option>
          </select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Categoría</Label>
          <select
            name="categoria"
            defaultValue={filters.categoryId ?? ""}
            className={selectClassName}
            aria-label="Categoría"
          >
            <option value="">Todas</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.isActive ? "" : " (inactiva)"}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Checkbox
            id="ver-anulados"
            name="anulados"
            value="1"
            defaultChecked={filters.includeVoided}
          />
          <Label htmlFor="ver-anulados" className="text-sm font-normal">
            Ver anulados
          </Label>
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant="outline">
            Filtrar
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/dinero?${periodQuery(period).toString()}`}>
              Limpiar
            </Link>
          </Button>
        </div>
        {filters.includeVoided ? (
          <Badge variant="secondary" className="mb-2">
            Los anulados no cuentan en totales ni en el export
          </Badge>
        ) : null}
      </form>

      <CashTable
        rows={movements.rows}
        currencyCode={currency}
        isAdmin={user.role === "admin"}
        hasFilters={Boolean(filters.kind || filters.categoryId)}
        clearFiltersHref={`/dinero?${periodQuery(period).toString()}`}
      />

      <PaginationLinks
        page={filters.page}
        pageCount={movements.pageCount}
        total={movements.total}
        hrefFor={hrefForPage}
      />
    </div>
  );
}
