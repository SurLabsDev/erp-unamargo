import { fromCents } from "@/lib/domain/cents";
import { formatMoney } from "@/lib/format";

/**
 * Ingresos y egresos mes a mes, en barras pareadas. Pareadas y no apiladas a
 * proposito: lo que se quiere leer de un vistazo es cual de las dos es mas
 * alta, y apiladas hay que restar de memoria.
 */
export function GraficoMeses({
  meses,
  currencyCode,
}: {
  meses: { mes: string; ingresosCentavos: bigint; egresosCentavos: bigint }[];
  currencyCode: string;
}) {
  const max = meses.reduce((a, m) => {
    const mayor = m.ingresosCentavos > m.egresosCentavos ? m.ingresosCentavos : m.egresosCentavos;
    return mayor > a ? mayor : a;
  }, 1n);

  const alto = (c: bigint) =>
    c === 0n ? "2px" : `${Math.max(Number((c * 100n) / max), 2)}%`;
  const nombreMes = (iso: string) => {
    const [a, m] = iso.split("-");
    return new Intl.DateTimeFormat("es-UY", { month: "short" })
      .format(new Date(Number(a), Number(m) - 1, 1))
      .replace(".", "");
  };

  return (
    <div>
      <div className="flex gap-2" style={{ height: 160 }}>
        {meses.map((m) => (
          <div key={m.mes} className="flex h-full flex-1 flex-col gap-1">
            <div className="flex min-h-0 flex-1 items-end gap-1">
              <div
                className="flex-1 rounded-t-sm bg-primary"
                style={{ height: alto(m.ingresosCentavos) }}
                title={`Ingresos ${formatMoney(fromCents(m.ingresosCentavos), currencyCode)}`}
              />
              <div
                className="flex-1 rounded-t-sm bg-muted-foreground/35"
                style={{ height: alto(m.egresosCentavos) }}
                title={`Egresos ${formatMoney(fromCents(m.egresosCentavos), currencyCode)}`}
              />
            </div>
            <span className="text-center text-[11px] text-muted-foreground">
              {nombreMes(m.mes)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-primary" />
          Ingresos
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-muted-foreground/35" />
          Egresos
        </span>
      </div>
    </div>
  );
}
