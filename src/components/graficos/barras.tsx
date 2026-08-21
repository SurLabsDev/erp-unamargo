/**
 * Barras horizontales con etiqueta y valor. Se usan para rankings -que producto
 * sale mas, en que se va la plata- porque el nombre de cada fila se lee entero,
 * cosa que en barras verticales no pasa.
 *
 * SVG no hace falta aca: son divs con un ancho porcentual, que ademas se
 * adaptan solos y no necesitan un viewBox.
 */
export function GraficoBarras({
  filas,
  formato,
  color = "bg-primary",
}: {
  filas: { etiqueta: string; valor: number; detalle?: string }[];
  formato: (valor: number) => string;
  color?: string;
}) {
  const max = Math.max(...filas.map((f) => f.valor), 1);

  return (
    <ul className="space-y-3">
      {filas.map((f) => (
        <li key={f.etiqueta}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{f.etiqueta}</span>
            <span className="shrink-0 font-medium tabular-nums">
              {formato(f.valor)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${color}`}
              style={{ width: `${Math.max((f.valor / max) * 100, 2)}%` }}
            />
          </div>
          {f.detalle && (
            <p className="mt-1 text-xs text-muted-foreground">{f.detalle}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
