import { formatInteger } from "@/lib/format";
import type { EfectoCampana } from "../queries";

/**
 * Si la campaña movió algo.
 *
 * **Lo que este bloque NO puede decir, y por qué.** El ERP no anota a qué
 * precio salió cada unidad ni bajo qué campaña, así que "cuántos vendí con este
 * descuento" no tiene respuesta en los datos que hay. Inventar un número que
 * parezca esa respuesta sería peor que no mostrar nada: se tomarían decisiones
 * de precio con él.
 *
 * Lo que sí dice: cuántas unidades salieron de los productos alcanzados
 * mientras la campaña corría, contra las que salieron en la misma cantidad de
 * días justo antes. Es una comparación honesta y suele alcanzar para saber si
 * vale la pena repetirla.
 */
export function EfectoDeLaCampana({ efecto }: { efecto: EfectoCampana }) {
  const {
    productosAlcanzados,
    unidadesDurante,
    unidadesAntes,
    diasDurante,
    enCurso,
  } = efecto;

  const variacion =
    unidadesAntes === 0
      ? null
      : Math.round(((unidadesDurante - unidadesAntes) / unidadesAntes) * 100);

  return (
    <section className="rounded-lg border">
      <header className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">¿Movió algo?</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Unidades que salieron de los productos alcanzados
          {enCurso ? " hasta hoy" : ""}, contra{" "}
          {diasDurante === 1
            ? "el día anterior"
            : `los ${formatInteger(diasDurante)} días anteriores`}
          .
        </p>
      </header>

      {productosAlcanzados === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          La campaña todavía no alcanza a ningún producto, así que no hay nada
          que medir. Agregale un objetivo acá abajo.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Alcanza a</dt>
              <dd className="type-display cifras text-2xl">
                {formatInteger(productosAlcanzados)}
              </dd>
              <p className="text-xs text-muted-foreground">
                {productosAlcanzados === 1 ? "producto" : "productos"}
              </p>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Durante la campaña
              </dt>
              <dd className="type-display cifras text-2xl">
                {formatInteger(unidadesDurante)}
              </dd>
              <p className="text-xs text-muted-foreground">unidades</p>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {diasDurante === 1
                  ? "El día previo"
                  : `Los ${formatInteger(diasDurante)} días previos`}
              </dt>
              <dd className="type-display cifras text-2xl">
                {formatInteger(unidadesAntes)}
              </dd>
              <p className="text-xs text-muted-foreground">unidades</p>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Diferencia</dt>
              <dd className="type-display cifras text-2xl">
                {variacion === null
                  ? "—"
                  : `${variacion > 0 ? "+" : ""}${variacion}%`}
              </dd>
              <p className="text-xs text-muted-foreground">
                {variacion === null
                  ? "No hubo salidas antes"
                  : `${unidadesDurante - unidadesAntes > 0 ? "+" : ""}${formatInteger(unidadesDurante - unidadesAntes)} unidades`}
              </p>
            </div>
          </dl>

          {/* La advertencia va abajo del numero y no escondida en una ayuda:
              quien mira esto esta por decidir si repite la campana. */}
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">
            Es una comparación, no una causa: puede haber cambiado otra cosa en
            el medio. Y una salida de stock no siempre es una venta, puede ser
            una rotura o un ajuste. El sistema no registra a qué precio salió
            cada unidad, así que no puede decir cuánto se vendió con el descuento
            aplicado.
          </p>
        </>
      )}
    </section>
  );
}
