"use client";

import { createPortal } from "react-dom";
import { useMemo, useSyncExternalStore } from "react";
import type { Boleta } from "./actions";
import {
  cuerpoTicket,
  documentoTicket,
  estilosIncrustados,
  fechaTicket,
  numeroTicket,
  type DatosTicket,
} from "./ticket-80mm";

/**
 * El ticket en pantalla y su copia para imprimir.
 *
 * Son el MISMO markup y el MISMO CSS, generados una sola vez: la vista previa
 * lo mete en un documento suelto dentro de un iframe -para que ninguna regla
 * del ERP lo toque mientras se mira- y la copia de impresion lo incrusta en la
 * pagina. Que sean uno solo no es prolijidad: la primera version tenia dos
 * renders, el de pantalla salia bien y el de papel no, y no habia forma de
 * darse cuenta sin gastar rollo.
 */
export function VistaTicket({
  boleta,
  empresa,
  moneda,
}: {
  boleta: Boleta;
  empresa: string;
  moneda: string;
}) {
  const datos = useMemo(
    () => datosDeVenta(boleta, empresa, moneda),
    [boleta, empresa, moneda],
  );
  const documento = useMemo(() => documentoTicket(datos), [datos]);

  return (
    <>
      <div className="max-h-[52vh] overflow-auto rounded-md border bg-neutral-100 p-3">
        <iframe
          title="Vista previa del ticket"
          srcDoc={documento}
          onLoad={(e) => {
            const doc = e.currentTarget.contentDocument;
            if (doc) e.currentTarget.style.height = `${altoDelTicketPx(doc)}px`;
          }}
          // El ancho es el del papel, no el del dialogo: 80mm son 80mm.
          style={{ width: "80mm", height: "150mm" }}
          className="mx-auto block border-0 bg-white shadow-sm"
        />
      </div>
      <TicketImpresion datos={datos} />
    </>
  );
}

/**
 * La copia que sale por la impresora.
 *
 * Cuelga de <body> por un portal y no del dialogo, porque el bloque de
 * impresion de `globals.css` apaga a los HIJOS DIRECTOS de <body> y deja
 * encendida solo a esta. Adentro del dialogo quedaria apagada con el resto.
 *
 * Se incrusta como HTML y no como un iframe. Se probo con iframe y en papel
 * salio un metro de rollo en blanco: al imprimir, el navegador vuelve a armar
 * el iframe desde su `srcdoc`, y lo que uno le agrega al DOM vivo no esta en
 * ese momento.
 */
function TicketImpresion({ datos }: { datos: DatosTicket }) {
  const montado = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const html = useMemo(() => cuerpoTicket(datos), [datos]);
  if (!montado) return null;
  return createPortal(
    <div className="impresion-ticket">
      <style dangerouslySetInnerHTML={{ __html: estilosIncrustados() }} />
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>,
    document.body,
  );
}

/**
 * Lo que la venta registrada le dice al ticket.
 *
 * El recuadro con borde NO es el "documento de demostracion" del template: es
 * la nota fiscal. Este comprobante no es una factura y decirlo en el papel es
 * obligatorio en los hechos -un papel que parece fiscal y no lo es es peor que
 * no dar ninguno-. El template ya tenia el componente dibujado; se le cambio el
 * texto, no el diseño.
 */
function datosDeVenta(
  boleta: Boleta,
  empresa: string,
  moneda: string,
): DatosTicket {
  return {
    tipo: "Venta",
    numero: numeroTicket(boleta.numero),
    fecha: fechaTicket(boleta.fecha),
    hora: boleta.hora,
    cajero: boleta.cajero,
    empresa,
    moneda,
    items: boleta.lineas.map((l) => ({
      nombre: l.nombre,
      cantidad: l.cantidad,
      precio: l.precio,
    })),
    aviso: {
      titulo: "COMPROBANTE DE ENTREGA",
      detalle: "Sin validez fiscal",
    },
    // El numero del movimiento de caja, sin el "#": escaneandolo se encuentra
    // la venta en el libro de Dinero sin traducir nada.
    codigoBarras: String(boleta.numero).padStart(6, "0"),
  };
}

function altoDelTicketPx(doc: Document): number {
  const nodo = doc.querySelector<HTMLElement>(".ticket");
  return nodo ? nodo.getBoundingClientRect().height : 0;
}

/**
 * Manda el ticket a la impresora.
 *
 * Imprime LA PAGINA, con el ticket como unico contenido encendido, y no le pide
 * al navegador ningun tamaño de hoja. Las dos cosas estan explicadas en el
 * bloque de impresion de `globals.css`; la segunda es la que costo tres
 * intentos: pedir una hoja de 80mm por lo que mide el ticket no achica el
 * papel, CENTRA el ticket en el papel que la impresora ya tiene.
 */
export function imprimirTicket() {
  window.print();
}
