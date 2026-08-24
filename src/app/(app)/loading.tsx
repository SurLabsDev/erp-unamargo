/**
 * Lo que se ve mientras el servidor arma la pantalla siguiente.
 *
 * Sin esto, al tocar un modulo el navegador SE QUEDA en el anterior hasta que
 * el servidor termina: no se mueve nada y se lee como si estuviera colgado. El
 * ERP no tarda menos ahora, pero el usuario ve que arranco, que es la mitad de
 * la percepcion de velocidad.
 *
 * Es un esqueleto con la forma del contenido final y no un spinner centrado
 * (design.md §6): asi lo que aparece despues cae donde ya estaba el hueco y la
 * pantalla no salta.
 */
function Barra({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-md bg-muted ${className}`} />
  );
}

export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando…</span>

      {/* Encabezado: titulo y bajada */}
      <div className="mb-6 grid gap-2">
        <Barra className="h-8 w-56" />
        <Barra className="h-4 w-80" />
      </div>

      {/* Cuatro tarjetas de cifras, como en el panel */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-md border p-4">
            <Barra className="h-3 w-28" />
            <Barra className="mt-3 h-8 w-32" />
            <Barra className="mt-3 h-3 w-40" />
          </div>
        ))}
      </div>

      {/* Un bloque ancho: grafica o tabla */}
      <div className="mt-4 rounded-md border p-4">
        <Barra className="h-4 w-40" />
        <Barra className="mt-4 h-48 w-full" />
      </div>
    </div>
  );
}
