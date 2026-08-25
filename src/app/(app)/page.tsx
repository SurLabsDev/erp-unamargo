import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GraficoBarras } from "@/components/graficos/barras";
import { GraficoLinea } from "@/components/graficos/linea";
import { GraficoMeses } from "@/components/graficos/meses";
import { requireUser } from "@/lib/auth-helpers";
import { fromCents, toCents } from "@/lib/domain/cents";
import { addDaysISO, diffDaysISO } from "@/lib/domain/dates";
import {
  diasDeCobertura,
  reparto,
  salidasPorDia,
  variacion,
} from "@/lib/domain/metrics";
import { computePeriodSummary, resolvePeriod } from "@/lib/domain/money";
import { MOVEMENT_TYPE_LABELS } from "@/lib/domain/stock";
import {
  formatDateTime,
  formatInteger,
  formatMoney,
  todayInTimeZone,
} from "@/lib/format";
import { singleParam } from "@/lib/params";
import { getSettings } from "@/lib/settings";
import {
  panelBajoStock,
  panelCajaPorMes,
  panelCampanas,
  panelEgresos,
  panelInventario,
  panelMovimientos,
  panelProductosConSalidas,
  panelSalidas,
  panelTotales,
} from "./panel-cache";

export const metadata: Metadata = { title: "Panel" };

function formatDelta(delta: number): string {
  return delta > 0 ? `+${formatInteger(delta)}` : formatInteger(delta);
}

/** Tarjeta de numero grande. `pie` sirve para la comparacion contra el periodo
 *  anterior, que es lo que convierte un numero suelto en una noticia. */
function Kpi({
  titulo,
  valor,
  pie,
  alerta,
}: {
  titulo: string;
  valor: string;
  pie?: string;
  /** Marca el pie como algo que hay que atender. NO es "el numero bajo": una
   *  baja de 5% contra el periodo anterior es ruido normal, y pintarla de rojo
   *  entrena al cliente a ignorar el rojo justo para cuando pase algo de
   *  verdad. Se reserva para lo accionable (productos por debajo del minimo). */
  alerta?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{titulo}</CardDescription>
        <CardTitle className="type-display cifras text-3xl">{valor}</CardTitle>
      </CardHeader>
      {pie && (
        <CardContent className="pt-0">
          {/* El verde NO se usa para "el numero subio". Es el acento de la
              marca y en este ERP significa accion, estado activo y foco
              (design.md §2); si ademas significara "buena cifra", el mismo
              verde diria dos cosas y el boton verde de al lado se leeria como
              un estado. La direccion ya la dice el signo del texto. */}
          <p
            className={`text-xs ${
              alerta ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {pie}
          </p>
        </CardContent>
      )}
    </Card>
  );
}

function SinDatos({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>
  );
}

export default async function PanelPage(props: PageProps<"/">) {
  const user = await requireUser();
  const settings = await getSettings();
  const hoy = todayInTimeZone(settings.timezone);

  const searchParams = await props.searchParams;
  const period = resolvePeriod(
    {
      preset: singleParam(searchParams.periodo),
      fromISO: singleParam(searchParams.desde),
      toISO: singleParam(searchParams.hasta),
    },
    hoy,
  );

  const desde = period.fromISO;
  // El periodo se corta HOY aunque el preset llegue mas lejos. "Mes actual" va
  // hasta fin de mes: sin este tope, los dias que todavia no pasaron se dibujan
  // en cero y parece que las ventas se derrumbaron, y encima la comparacion
  // enfrenta 21 dias de datos contra 31 del periodo anterior.
  const hasta = period.toISO > hoy ? hoy : period.toISO;
  // El periodo anterior es del MISMO largo y termina el dia antes: comparar un
  // mes contra 30 dias fijos daria una variacion inventada.
  const DIAS = diffDaysISO(desde, hasta) + 1;
  const hastaPrevio = addDaysISO(desde, -1);
  const desdePrevio = addDaysISO(hastaPrevio, -(DIAS - 1));

  const presetHref = (preset: string) => `/?periodo=${preset}`;

  const [
    lowStock,
    recentMovements,
    totals,
    activeCampaigns,
    salidas,
    salidasPrevias,
    catalogo,
    inventarioCentavos,
    meses,
    egresos,
  ] = await Promise.all([
    panelBajoStock(),
    panelMovimientos(5),
    panelTotales(period),
    panelCampanas(hoy),
    panelSalidas(desde, hasta),
    panelSalidas(desdePrevio, hastaPrevio),
    panelProductosConSalidas(desde, hasta),
    panelInventario(),
    panelCajaPorMes(6),
    panelEgresos(desde, hasta),
  ]);

  const summary = computePeriodSummary(settings.initialBalance, totals);
  const serie = salidasPorDia(salidas, desde, hasta);
  const unidades = salidas.reduce((a, s) => a + s.cantidad, 0);
  const unidadesPrevias = salidasPrevias.reduce((a, s) => a + s.cantidad, 0);
  const cambio = variacion(unidades, unidadesPrevias);

  const masSalen = catalogo
    .filter((p) => p.salidas > 0)
    .sort((a, b) => b.salidas - a.salidas)
    .slice(0, 6);

  // Los que se quedan sin stock primero al ritmo actual. Ordena por cobertura y
  // no por stock: 10 unidades que vuelan urgen mas que 3 que no se mueven.
  const seAcaban = catalogo
    .map((p) => ({ ...p, cobertura: diasDeCobertura(p.stock, p.salidas, DIAS) }))
    .filter((p): p is typeof p & { cobertura: number } => p.cobertura !== null)
    .sort((a, b) => a.cobertura - b.cobertura)
    .slice(0, 6);

  // Plata quieta: hay stock y no salio nada en el periodo.
  const parados = catalogo
    .filter((p) => p.salidas === 0 && p.stock > 0)
    .sort((a, b) => b.stock - a.stock)
    .slice(0, 6);

  const porRubro = reparto(
    [
      ...catalogo.reduce((m, p) => {
        const k = p.rubro ?? "Sin rubro";
        m.set(k, (m.get(k) ?? 0) + p.salidas);
        return m;
      }, new Map<string, number>()),
    ]
      .map(([etiqueta, valor]) => ({ etiqueta, valor }))
      .filter((f) => f.valor > 0),
  );

  const mesesGrafico = meses.map((m) => ({
    mes: m.mes,
    ingresosCentavos: toCents(m.ingresos),
    egresosCentavos: toCents(m.egresos),
  }));

  const unidadesEnStock = catalogo.reduce((a, p) => a + p.stock, 0);
  const hayMovimientos = salidas.length > 0;

  return (
    <div>
      <PageHeader
        title={`Hola, ${user.name.split(" ")[0]}`}
        description="Resumen de la operación."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border p-3">
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
          <Input
            type="date"
            name="desde"
            defaultValue={period.preset === "custom" ? period.fromISO : ""}
            aria-label="Desde"
            className="w-auto"
          />
          <Input
            type="date"
            name="hasta"
            defaultValue={period.preset === "custom" ? period.toISO : ""}
            aria-label="Hasta"
            className="w-auto"
          />
          <Button type="submit" size="sm" variant="outline">
            Aplicar
          </Button>
        </form>
      </div>

      {activeCampaigns > 0 && (
        <Link
          href="/descuentos"
          className="mb-4 flex items-center justify-between gap-3 rounded-md border bg-muted/50 px-4 py-3 text-sm hover:border-foreground/30"
        >
          <span>
            {activeCampaigns === 1
              ? "Hay 1 campaña de descuento vigente."
              : `Hay ${activeCampaigns} campañas de descuento vigentes.`}
          </span>
          <span className="text-muted-foreground">Ver</span>
        </Link>
      )}

      {/* --- Los cuatro numeros de arriba ------------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          titulo={`Unidades que salieron (${formatInteger(DIAS)} días)`}
          valor={formatInteger(unidades)}
          pie={
            cambio === null
              ? unidadesPrevias === 0 && unidades > 0
                ? "Primer período con movimiento"
                : "Sin movimientos para comparar"
              : `${cambio > 0 ? "+" : ""}${cambio.toFixed(0)}% contra los ${formatInteger(DIAS)} días anteriores`
          }
        />
        <Kpi
          titulo="Saldo del período"
          valor={formatMoney(summary.closingBalance, settings.currencyCode)}
          pie={`Ingresos ${formatMoney(summary.income, settings.currencyCode)} · Egresos ${formatMoney(summary.expense, settings.currencyCode)}`}
        />
        <Kpi
          titulo="Inventario a precio de lista"
          valor={
            inventarioCentavos > 0n
              ? formatMoney(fromCents(inventarioCentavos), settings.currencyCode)
              : "Sin precios"
          }
          pie={
            inventarioCentavos > 0n
              ? `${formatInteger(unidadesEnStock)} unidades en ${formatInteger(catalogo.length)} productos`
              : `${formatInteger(unidadesEnStock)} unidades sin precio cargado`
          }
        />
        <Kpi
          titulo="Productos en quiebre"
          valor={formatInteger(lowStock.length)}
          pie={
            lowStock.length === 0
              ? "Nadie por debajo del mínimo"
              : "Por debajo del mínimo o sin stock"
          }
          alerta={lowStock.length > 0}
        />
      </div>

      {/* --- El pulso: salidas por dia ---------------------------------- */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Salidas por día</CardTitle>
          <CardDescription>
            Unidades que salieron del depósito cada día del período.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hayMovimientos ? (
              <GraficoLinea serie={serie} etiqueta="Salidas por día" />
          ) : (
            <SinDatos>
              Todavía no hay salidas registradas. En cuanto empieces a cargar
              movimientos en Stock, acá vas a ver el ritmo de venta día a día.
            </SinDatos>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* --- Lo que mas sale ----------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Lo que más sale</CardTitle>
            <CardDescription>
              Unidades que salieron en el período. Una salida puede ser una
              venta o una baja: el libro registra el movimiento, no el motivo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {masSalen.length > 0 ? (
              <GraficoBarras
                filas={masSalen.map((p) => ({
                  etiqueta: p.nombre,
                  valor: p.salidas,
                  detalle: `${formatInteger(p.stock)} en stock`,
                }))}
                formato={(v) => `${formatInteger(v)} u.`}
              />
            ) : (
              <SinDatos>Sin salidas en el período.</SinDatos>
            )}
          </CardContent>
        </Card>

        {/* --- Los que se acaban primero -------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Se acaban primero</CardTitle>
            <CardDescription>
              Cuántos días dura el stock al ritmo del período. Ordena
              mejor que el mínimo fijo: 10 unidades que vuelan urgen más que 3
              que no se mueven.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {seAcaban.length > 0 ? (
              <ul className="space-y-3">
                {seAcaban.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <Link prefetch={false}
                      href={`/stock/${p.id}`}
                      className="truncate underline-offset-4 hover:underline"
                    >
                      {p.nombre}
                    </Link>
                    <span className="shrink-0 tabular-nums">
                      <span
                        className={
                          p.cobertura <= 7 ? "font-medium text-destructive" : ""
                        }
                      >
                        {p.cobertura < 1
                          ? "menos de 1 día"
                          : `${Math.round(p.cobertura)} días`}
                      </span>
                      <span className="ml-2 text-muted-foreground">
                        {formatInteger(p.stock)} u.
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <SinDatos>
                Hace falta al menos una salida para estimar cuánto dura el stock.
              </SinDatos>
            )}
          </CardContent>
        </Card>

        {/* --- Plata quieta --------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Stock parado</CardTitle>
            <CardDescription>
              Tienen stock y no salió ninguna unidad en el período.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {parados.length > 0 ? (
              <ul className="space-y-2">
                {parados.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <Link prefetch={false}
                      href={`/stock/${p.id}`}
                      className="truncate underline-offset-4 hover:underline"
                    >
                      {p.nombre}
                    </Link>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatInteger(p.stock)} u.
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <SinDatos>
                {hayMovimientos
                  ? "Todo lo que tiene stock tuvo movimiento."
                  : "Sin movimientos todavía."}
              </SinDatos>
            )}
          </CardContent>
        </Card>

        {/* --- Que rubro mueve ------------------------------------------ */}
        <Card>
          <CardHeader>
            <CardTitle>Qué rubro mueve</CardTitle>
            <CardDescription>
              Reparto de las salidas por categoría.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {porRubro.length > 0 ? (
              <GraficoBarras
                filas={porRubro.map((r) => ({
                  etiqueta: r.etiqueta,
                  valor: r.valor,
                  detalle: `${r.porcentaje.toFixed(0)}% del total`,
                }))}
                formato={(v) => `${formatInteger(v)} u.`}
              />
            ) : (
              <SinDatos>Sin salidas en el período.</SinDatos>
            )}
          </CardContent>
        </Card>

        {/* --- Caja mes a mes ------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Caja mes a mes</CardTitle>
            <CardDescription>
              Ingresos y egresos de los últimos 6 meses con movimiento.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mesesGrafico.length > 0 ? (
              <GraficoMeses
                meses={mesesGrafico}
                currencyCode={settings.currencyCode}
              />
            ) : (
              <SinDatos>
                Todavía no hay movimientos de caja cargados.
              </SinDatos>
            )}
          </CardContent>
        </Card>

        {/* --- En que se va la plata ------------------------------------ */}
        <Card>
          <CardHeader>
            <CardTitle>En qué se va la plata</CardTitle>
            <CardDescription>
              Egresos por categoría en el período.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {egresos.length > 0 ? (
              <GraficoBarras
                filas={reparto(egresos).map((e) => ({
                  etiqueta: e.etiqueta,
                  valor: e.valor,
                  detalle: `${e.porcentaje.toFixed(0)}% de los egresos`,
                }))}
                formato={(v) =>
                  formatMoney(fromCents(BigInt(v)), settings.currencyCode)
                }
                color="bg-muted-foreground/50"
              />
            ) : (
              <SinDatos>Sin egresos en el período.</SinDatos>
            )}
          </CardContent>
        </Card>
      </div>

      {/* --- Quiebres y ultimos movimientos ----------------------------- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Quiebres de stock</CardTitle>
              <CardDescription>Por debajo del mínimo o sin stock.</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/stock">Ver stock</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {lowStock.length > 0 ? (
              <ul className="space-y-2">
                {lowStock.slice(0, 6).map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <Link prefetch={false}
                      href={`/stock/${p.id}`}
                      className="truncate underline-offset-4 hover:underline"
                    >
                      {p.name}
                    </Link>
                    <Badge variant={p.currentStock === 0 ? "destructive" : "secondary"}>
                      {p.currentStock === 0
                        ? "Sin stock"
                        : `${formatInteger(p.currentStock)} / mín. ${formatInteger(p.minStock)}`}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <SinDatos>Ningún producto por debajo del mínimo.</SinDatos>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Últimos movimientos</CardTitle>
              <CardDescription>Lo último que pasó en el depósito.</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/stock/movimientos">Ver historial</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recentMovements.length > 0 ? (
              <ul className="space-y-2">
                {recentMovements.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">
                      <span className="text-muted-foreground">
                        {MOVEMENT_TYPE_LABELS[m.type]}
                      </span>{" "}
                      {m.productName}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatDelta(m.delta)} ·{" "}
                      {formatDateTime(m.createdAt, settings.timezone)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <SinDatos>Todavía no hay movimientos.</SinDatos>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        El ERP registra movimientos de caja, no ventas por producto, así que no
        hay ticket promedio ni margen: no existe la relación entre lo que entra a
        la caja y qué productos salieron. El inventario se valúa a precio de
        exhibición, que no es lo que costó la mercadería.
      </p>
    </div>
  );
}
