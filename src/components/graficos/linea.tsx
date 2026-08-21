import { escalaY } from "@/lib/domain/metrics";
import { formatInteger } from "@/lib/format";

/**
 * Serie diaria con ejes. SVG a mano, sin librerias: el repo prohibe
 * dependencias de graficos (AGENTS.md regla 6). Server Component: no manda un
 * byte de JavaScript.
 *
 * Ojo con `preserveAspectRatio="none"`: estira el viewBox y deforma el texto.
 * Por eso este grafico usa la relacion de aspecto normal y las etiquetas
 * escalan parejo con el dibujo.
 */
const ANCHO = 960;
const ALTO = 280;
const M = { arriba: 14, derecha: 12, abajo: 30, izquierda: 46 };

function ddmm(iso: string): string {
  return `${iso.slice(8)}/${iso.slice(5, 7)}`;
}

export function GraficoLinea({
  serie,
  etiqueta,
}: {
  serie: { fecha: string; valor: number }[];
  etiqueta: string;
}) {
  const maximo = Math.max(...serie.map((p) => p.valor), 0);
  const { tope, valores } = escalaY(maximo);

  const x0 = M.izquierda;
  const x1 = ANCHO - M.derecha;
  const y0 = M.arriba;
  const y1 = ALTO - M.abajo;

  const px = (i: number) =>
    serie.length > 1 ? x0 + (i * (x1 - x0)) / (serie.length - 1) : (x0 + x1) / 2;
  const py = (v: number) => y1 - (v / tope) * (y1 - y0);

  const puntos = serie.map((p, i) => ({ ...p, x: px(i), y: py(p.valor) }));
  const linea = puntos
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const area = `${linea} L${x1} ${y1} L${x0} ${y1} Z`;

  // Cuantas fechas caben abajo sin encimarse. Con 90 dias se muestra una de
  // cada tantas, siempre incluyendo la primera y la ultima.
  const cadaCuantas = Math.max(1, Math.ceil(serie.length / 7));
  const total = serie.reduce((a, p) => a + p.valor, 0);
  const pico = puntos.reduce((a, p) => (p.valor > a.valor ? p : a), puntos[0]);

  return (
    <svg
      viewBox={`0 0 ${ANCHO} ${ALTO}`}
      className="h-auto w-full"
      role="img"
      aria-label={`${etiqueta}. Total ${formatInteger(total)} unidades en ${serie.length} días, con un máximo de ${formatInteger(maximo)}.`}
    >
      <defs>
        <linearGradient id="degradadoLinea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.20" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grilla y numeros del eje vertical */}
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
            {formatInteger(v)}
          </text>
        </g>
      ))}

      <path d={area} fill="url(#degradadoLinea)" />
      <path
        d={linea}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Un punto por dia. Los dias en cero tambien se marcan: que se vea que
          ese dia existio y no salio nada. */}
      {puntos.map((p) => (
        <circle
          key={p.fecha}
          cx={p.x}
          cy={p.y}
          r={p.fecha === pico?.fecha ? 4 : 2.5}
          className={p.fecha === pico?.fecha ? "fill-primary" : "fill-background"}
          stroke="var(--color-primary)"
          strokeWidth="1.5"
        />
      ))}

      {/* El valor del pico, escrito. Es el numero que se busca en un vistazo. */}
      {pico && maximo > 0 && (
        <text
          x={Math.min(Math.max(pico.x, x0 + 14), x1 - 14)}
          y={pico.y - 12}
          textAnchor="middle"
          className="fill-foreground"
          style={{ fontSize: 14, fontWeight: 600 }}
        >
          {formatInteger(pico.valor)}
        </text>
      )}

      {/* Fechas del eje horizontal */}
      {puntos.map((p, i) =>
        i % cadaCuantas === 0 || i === puntos.length - 1 ? (
          <text
            key={`f-${p.fecha}`}
            x={p.x}
            y={ALTO - 8}
            textAnchor={i === 0 ? "start" : i === puntos.length - 1 ? "end" : "middle"}
            className="fill-muted-foreground"
            style={{ fontSize: 12 }}
          >
            {ddmm(p.fecha)}
          </text>
        ) : null,
      )}
    </svg>
  );
}
