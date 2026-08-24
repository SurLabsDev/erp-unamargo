import Image from "next/image";
import { formatMoney } from "@/lib/format";

/**
 * Cómo se ve este producto en la tienda pública.
 *
 * No es decoración: el ERP y la web son dos repos distintos, así que hasta
 * ahora la única forma de saber cómo quedaba una ficha era guardarla, abrir la
 * web y buscarla. Con precio, descripción y fotos que se editan acá, ese viaje
 * de ida y vuelta se hacía en cada cambio.
 *
 * Se replican los elementos que decide el ERP -foto, rubro, nombre, precio,
 * descripción y disponibilidad- con la tipografía y el redondeo de la marca.
 * NO pretende ser un clon pixel a pixel de la web: si lo fuera, habría que
 * mantenerlo sincronizado con el otro repo y se desincronizaría en la primera
 * semana. Lo que tiene que responder es "¿se entiende y está completo?".
 */
export function VistaPrevia(props: {
  nombre: string;
  precio: string | null;
  precioFinal?: string | null;
  descuento?: { percentage: number; campaignName: string } | null;
  descripcion: string | null;
  categoria: string | null;
  subtipo: string | null;
  foto: string | null;
  hayStock: boolean;
  moneda: string;
}) {
  const {
    nombre,
    precio,
    precioFinal,
    descuento,
    descripcion,
    categoria,
    subtipo,
    foto,
    hayStock,
    moneda,
  } = props;

  const faltan = [
    !foto && "una foto",
    !precio && "el precio",
    !descripcion && "la descripción",
    !categoria && "la categoría",
  ].filter(Boolean) as string[];

  return (
    <section className="rounded-md border">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-medium">Así se ve en la tienda</h2>
        <p className="text-xs text-muted-foreground">
          Aproximado. La tienda es la que manda.
        </p>
      </header>

      <div className="grid gap-6 p-4 sm:grid-cols-2">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-muted">
          {foto ? (
            <Image
              src={foto}
              alt={nombre}
              width={420}
              height={420}
              className="h-full w-full object-contain p-4"
            />
          ) : (
            <p className="px-6 text-center text-xs text-muted-foreground">
              Sin fotos. En la tienda queda un recuadro vacío.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {(categoria || subtipo) && (
            <div className="flex flex-wrap gap-2">
              {categoria && (
                <span className="rounded-pill border px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {categoria}
                </span>
              )}
              {subtipo && (
                <span className="rounded-pill bg-muted px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {subtipo}
                </span>
              )}
            </div>
          )}

          <h3 className="type-display text-2xl">{nombre}</h3>

          {precio === null ? (
            <p className="text-sm text-destructive">
              Sin precio: no se puede vender.
            </p>
          ) : descuento && precioFinal ? (
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="type-display cifras text-2xl">
                {formatMoney(precioFinal, moneda)}
              </span>
              <span className="cifras text-sm text-muted-foreground line-through">
                {formatMoney(precio, moneda)}
              </span>
              <span className="rounded-pill bg-primary px-2 py-0.5 text-[11px] text-primary-foreground">
                {descuento.campaignName} -{descuento.percentage}%
              </span>
            </div>
          ) : (
            <span className="type-display cifras text-2xl">
              {formatMoney(precio, moneda)}
            </span>
          )}

          {descripcion ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {descripcion}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Sin descripción. En la tienda el producto queda mudo.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            {hayStock ? "Disponible" : "Sin stock"}
          </p>
        </div>
      </div>

      {faltan.length > 0 && (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground">
          Le falta {faltan.join(", ")}.
        </p>
      )}
    </section>
  );
}
