import { formatInteger } from "@/lib/format";

/**
 * Serie diaria como area + linea. SVG a mano, sin librerias: el repo prohibe
 * dependencias de graficos (AGENTS.md regla 6) y para una serie de 30 puntos
 * una libreria pesa mas que el grafico entero.
 *
 * Es un Server Component: no hay estado ni interaccion, asi que no manda ni un
 * byte de JavaScript al navegador.
 */
export function GraficoLinea({
  serie,
  etiqueta,
  alto = 120,
}: {
  serie: { fecha: string; valor: number }[];
  etiqueta: string;
  alto?: number;
}) {
  const ancho = 600;
  const max = Math.max(...serie.map((p) => p.valor), 1);
  const paso = serie.length > 1 ? ancho / (serie.length - 1) : ancho;

  const puntos = serie.map((p, i) => ({
    x: i * paso,
    // Se deja un 8% de aire arriba para que el pico no toque el borde.
    y: alto - (p.valor / max) * (alto * 0.92),
  }));

  const linea = puntos
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const area = `${linea} L${ancho} ${alto} L0 ${alto} Z`;

  const total = serie.reduce((a, p) => a + p.valor, 0);
  const pico = serie.reduce((a, p) => (p.valor > a.valor ? p : a), serie[0]);

  return (
    <svg
      viewBox={`0 0 ${ancho} ${alto}`}
      className="h-auto w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${etiqueta}. Total ${formatInteger(total)} en ${serie.length} días. Máximo ${formatInteger(pico?.valor ?? 0)}.`}
    >
      <defs>
        <linearGradient id="degradadoLinea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#degradadoLinea)" />
      <path
        d={linea}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
