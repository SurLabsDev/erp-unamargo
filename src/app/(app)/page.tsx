import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth-helpers";
import { computePeriodSummary, resolvePeriod } from "@/lib/domain/money";
import { MOVEMENT_TYPE_LABELS } from "@/lib/domain/stock";
import {
  formatDate,
  formatDateTime,
  formatInteger,
  formatMoney,
  todayInTimeZone,
} from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { periodTotals } from "./dinero/queries";
import {
  listLowStockProducts,
  listRecentMovements,
} from "./stock/queries";

export const metadata: Metadata = { title: "Panel" };

function formatDelta(delta: number): string {
  return delta > 0 ? `+${formatInteger(delta)}` : formatInteger(delta);
}

export default async function PanelPage() {
  const user = await requireUser();
  const settings = await getSettings();
  const period = resolvePeriod({}, todayInTimeZone(settings.timezone));
  const [lowStock, recentMovements, totals] = await Promise.all([
    listLowStockProducts(),
    listRecentMovements(5),
    periodTotals(period),
  ]);
  const summary = computePeriodSummary(settings.initialBalance, totals);

  return (
    <div>
      <PageHeader
        title={`Hola, ${user.name.split(" ")[0]}`}
        description="Resumen general de la operación."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Stock bajo
              {lowStock.length > 0 ? (
                <Badge variant="destructive">{lowStock.length}</Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              Productos activos en o por debajo de su mínimo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {lowStock.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay productos por debajo del mínimo.
              </p>
            ) : (
              <ul className="grid gap-2">
                {lowStock.map((product) => (
                  <li key={product.id}>
                    <Link
                      href={`/stock/${product.id}`}
                      className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:border-foreground/30"
                    >
                      <span className="min-w-0">
                        <span className="font-mono text-xs">{product.sku}</span>{" "}
                        <span className="text-muted-foreground">
                          {product.name}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatInteger(product.currentStock)}{" "}
                        <span className="text-muted-foreground">
                          / mín {formatInteger(product.minStock)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimos movimientos</CardTitle>
            <CardDescription>
              Actividad reciente del depósito.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentMovements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Todavía no hay movimientos.{" "}
                <Link href="/stock" className="underline underline-offset-4">
                  Registrá el primero.
                </Link>
              </p>
            ) : (
              <ul className="grid gap-2">
                {recentMovements.map((movement) => (
                  <li
                    key={movement.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-mono text-xs">
                        {movement.productSku}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        {MOVEMENT_TYPE_LABELS[movement.type]}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatDelta(movement.delta)}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(movement.createdAt, settings.timezone)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Button asChild variant="link" size="sm" className="mt-2 px-0">
              <Link href="/stock/movimientos">Ver historial completo</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Dinero — mes actual</CardTitle>
            <CardDescription>
              {formatDate(period.fromISO)} a {formatDate(period.toISO)} ·
              Control interno. No reemplaza la contabilidad formal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Ingresos</dt>
                <dd className="text-lg font-medium tabular-nums">
                  +{formatMoney(summary.income, settings.currencyCode)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Egresos</dt>
                <dd className="text-lg font-medium tabular-nums">
                  −{formatMoney(summary.expense, settings.currencyCode)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Resultado</dt>
                <dd className="text-lg font-medium tabular-nums">
                  {formatMoney(summary.result, settings.currencyCode)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  Saldo al cierre
                </dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {formatMoney(summary.closingBalance, settings.currencyCode)}
                </dd>
              </div>
            </dl>
            <Button asChild variant="link" size="sm" className="mt-2 px-0">
              <Link href="/dinero">Ver balance completo</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
