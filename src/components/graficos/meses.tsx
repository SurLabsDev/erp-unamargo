import { fromCents } from "@/lib/domain/cents";
import { abreviarMonto, escalaY } from "@/lib/domain/metrics";
import { formatMoney } from "@/lib/format";

/**
 * Ingresos y egresos mes a mes, en barras pareadas y CON NUMEROS: un grafico
 * sin cifras obliga a adivinar, y adivinar plata no sirve.
 *
 * Pareadas y no apiladas a proposito: lo que se quiere leer de un vistazo es
 * cual de las dos es mas alta, y apiladas hay que restar de memoria.
 *
 * SVG y no divs: hacen falta ejes y texto ubicado con precision, y ademas una
 * altura en porcentaje solo resuelve si el padre tiene altura definida, que con
 * flex es facil de romper sin darse cuenta.
 */
const ANCHO = 960;
const ALTO = 300;
const M = { arriba: 24, derecha: 12, abajo: 44, izquierda: 64 };

export function GraficoMeses({
  meses,
  currencyCode,
}: {
  meses: { mes: string; ingresosCentavos: bigint; egresosCentavos: bigint }[];
  currencyCode: string;
}) {
  // Para el eje alcanza con pesos como numero: es una posicion en pantalla, no
  // una cuenta. La plata exacta sigue saliendo de los centavos con BigInt.
  const enPesos = (c: bigint) => Number(c) / 100;
  const maximo = meses.reduce(
    (a, m) => Math.max(a, enPesos(m.ingresosCentavos), enPesos(m.egresosCentavos)),
    0,
  );
  const { tope, valores } = escalaY(maximo, 4);

  const x0 = M.izquierda;
  const x1 = ANCHO - M.derecha;
  const y0 = M.arriba;
  const y1 = ALTO - M.abajo;

  const anchoGrupo = (x1 - x0) / Math.max(meses.length, 1);
  const anchoBarra = Math.min(anchoGrupo * 0.34, 46);
  const py = (v: number) => y1 - (v / tope) * (y1 - y0);

  const nombreMes = (iso: string) => {
    const [a, m] = iso.split("-");
    return new Intl.DateTimeFormat("es-UY", { month: "short" })
      .format(new Date(Number(a), Number(m) - 1, 1))
      .replace(".", "");
  };

  const totalIngresos = meses.reduce((a, m) => a + m.ingresosCentavos, 0n);
  const totalEgresos = meses.reduce((a, m) => a + m.egresosCentavos, 0n);

  return (
    <div>
      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Ingresos y egresos por mes. Ingresos ${formatMoney(fromCents(totalIngresos), currencyCode)}, egresos ${formatMoney(fromCents(totalEgresos), currencyCode)} en ${meses.length} meses.`}
      >
        {/* Grilla y montos del eje vertical */}
        {valores.map((v) => (
          <g key={v}>
            <line
              x1={x0}
              x2={x1}
              y1={py(v)}
              y2={py(v)}
              stroke="var(--color-border)"
              strokeWidth="1"
              strokeDasharray={v === 0 ? undefined : "3 4"}
            />
            <text
              x={x0 - 10}
              y={py(v) + 4}
              textAnchor="end"
              className="fill-muted-foreground"
              style={{ fontSize: 13 }}
            >
              {abreviarMonto(v)}
            </text>
          </g>
        ))}

        {meses.map((m, i) => {
          const centro = x0 + anchoGrupo * (i + 0.5);
          const ing = enPesos(m.ingresosCentavos);
          const egr = enPesos(m.egresosCentavos);
          const barras = [
            { v: ing, x: centro - anchoBarra - 3, clase: "fill-primary" },
            { v: egr, x: centro + 3, clase: "fill-muted-foreground/40" },
          ];
          return (
            <g key={m.mes}>
              {barras.map((b, k) => (
                <g key={k}>
                  {/* Un mes en cero deja una marca fina: que se vea que el mes
                      existio y estuvo en cero, en vez de desaparecer. */}
                  <rect
                    x={b.x}
                    y={b.v > 0 ? py(b.v) : y1 - 2}
                    width={anchoBarra}
                    height={b.v > 0 ? Math.max(y1 - py(b.v), 2) : 2}
                    rx="3"
                    className={b.clase}
                  />
                  {b.v > 0 && (
                    <text
                      x={b.x + anchoBarra / 2}
                      y={py(b.v) - 7}
                      textAnchor="middle"
                      className={k === 0 ? "fill-foreground" : "fill-muted-foreground"}
                      style={{ fontSize: 12, fontWeight: k === 0 ? 600 : 400 }}
                    >
                      {abreviarMonto(b.v)}
                    </text>
                  )}
                </g>
              ))}
              <text
                x={centro}
                y={ALTO - 22}
                textAnchor="middle"
                className="fill-muted-foreground"
                style={{ fontSize: 13 }}
              >
                {nombreMes(m.mes)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-primary" />
          Ingresos {formatMoney(fromCents(totalIngresos), currencyCode)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-muted-foreground/40" />
          Egresos {formatMoney(fromCents(totalEgresos), currencyCode)}
        </span>
      </div>
    </div>
  );
}
