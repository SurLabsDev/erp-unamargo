"use client";

import { createPortal } from "react-dom";
import { useSyncExternalStore } from "react";
import { Unamargo } from "@/components/marca";
import { formatMoney } from "@/lib/format";
import type { Boleta as DatosBoleta } from "./actions";

/**
 * La boleta que sale por la impresora de tickets.
 *
 * Esta pensada para papel termico de 80mm, que impone casi todo el diseño:
 *
 *  - **Sin grises ni fondos.** La termica no tiene tinta: quema el papel. Un
 *    gris sale como una mancha punteada sucia. Todo es negro puro sobre blanco,
 *    y la jerarquia se hace con TAMAÑO y PESO, nunca con color.
 *  - **Ancho fijo de 72mm** de contenido sobre 80mm de papel. Un `max-width`
 *    en porcentaje no sirve: el navegador no sabe cuanto mide el rollo.
 *  - **Puntos guia** entre el producto y el precio. No es decoracion: en una
 *    columna angosta el ojo pierde la fila, y es la convencion que la gente ya
 *    sabe leer en un ticket.
 *  - **Alto automatico** (`size: 80mm auto`): el rollo no tiene paginas, asi
 *    que fijar un alto cortaria la boleta o tiraria papel de mas.
 *
 * En pantalla se ve igual que en papel, al mismo ancho, para que el que cobra
 * sepa que va a salir antes de gastar el rollo.
 */
export function Boleta({
  datos,
  empresa,
  moneda,
}: {
  datos: DatosBoleta;
  empresa: string;
  moneda: string;
}) {
  const unidades = datos.lineas.reduce((a, l) => a + l.cantidad, 0);

  return (
    <div className="boleta">
      <header className="boleta-cabeza">
        <Unamargo className="boleta-marca" />
        <p className="boleta-nombre">{empresa}</p>
      </header>

      <div className="boleta-meta">
        <span>Boleta N° {datos.numero}</span>
        <span>{datos.fecha.split("-").reverse().join("/")}</span>
      </div>

      <hr className="boleta-linea" />

      <ul className="boleta-items">
        {datos.lineas.map((l) => (
          <li key={l.sku} className="boleta-item">
            <p className="boleta-item-nombre">{l.nombre}</p>
            <p className="boleta-item-cuenta">
              <span>
                {l.cantidad} x {formatMoney(l.precio, moneda)}
              </span>
              <span className="boleta-puntos" aria-hidden />
              <span className="boleta-item-total">
                {formatMoney(
                  (Number(l.precio) * l.cantidad).toFixed(2),
                  moneda,
                )}
              </span>
            </p>
          </li>
        ))}
      </ul>

      <hr className="boleta-linea" />

      <div className="boleta-total">
        <span>Total</span>
        <span>{formatMoney(datos.total, moneda)}</span>
      </div>
      <p className="boleta-unidades">
        {unidades} {unidades === 1 ? "artículo" : "artículos"}
      </p>

      <footer className="boleta-pie">
        <p>¡Gracias por tu compra!</p>
        {/* Sin datos fiscales a proposito: esto es un comprobante interno de
            entrega, no una factura. Poner algo que parezca fiscal y no lo sea
            es peor que no poner nada. */}
        <p className="boleta-nota">Comprobante de entrega. No es factura.</p>
      </footer>
    </div>
  );
}

/**
 * La copia que sale por la impresora.
 *
 * Va colgada de <body> por un portal, y no dentro del dialogo, por dos razones
 * que son exactamente los dos sintomas que tuvo la primera version:
 *
 *  - **Salia centrada.** `position: absolute` se mide contra el ancestro
 *    posicionado mas cercano, que era el dialogo, no la pagina. Colgando de
 *    <body> no hay ancestro que la corra.
 *  - **Salian metros de papel.** El CSS de impresion ahora esconde con
 *    `display: none` a todos los hermanos, asi que la boleta queda como unico
 *    contenido y el papel mide lo que mide ella.
 *
 * Si, esto renderiza la boleta dos veces: la de la pantalla vive dentro del
 * dialogo y esta vive en <body>. Son treinta lineas de HTML y evita pelear
 * contra el posicionamiento del dialogo, que es la clase de pelea que ya se
 * perdio una vez con el cajon del carrito.
 */
export function BoletaImpresion(props: {
  datos: DatosBoleta;
  empresa: string;
  moneda: string;
}) {
  const montado = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!montado) return null;
  return createPortal(
    <div className="boleta-impresion">
      <Boleta {...props} />
    </div>,
    document.body,
  );
}
