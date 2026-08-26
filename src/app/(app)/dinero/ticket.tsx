"use client";

import { useMemo, useState, type RefObject } from "react";
import type { Boleta } from "./actions";
import {
  documentoTicket,
  fechaTicket,
  numeroTicket,
  type DatosTicket,
} from "./ticket-80mm";

/** 1mm = 96/25.4 px de CSS. */
const PX_POR_MM = 96 / 25.4;

/**
 * La vista previa del ticket.
 *
 * No es "una version en pantalla parecida a la impresa": es EL MISMO documento
 * que se manda a la impresora -el de imprimir agrega el largo del papel y el
 * script que se imprime solo, nada mas-, al ancho real del papel. Antes habia
 * dos renders, uno para la pantalla y otro escondido para imprimir, y eso ya se
 * pago caro: el que se veia estaba bien y el que salia no, y no habia forma de
 * darse cuenta sin gastar rollo.
 */
export function VistaTicket({
  boleta,
  empresa,
  moneda,
  iframeRef,
}: {
  boleta: Boleta;
  empresa: string;
  moneda: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
}) {
  const documento = useMemo(
    () => documentoTicket(datosDeVenta(boleta, empresa, moneda)),
    [boleta, empresa, moneda],
  );
  const [alto, setAlto] = useState<number | null>(null);

  return (
    <div className="max-h-[52vh] overflow-auto rounded-md border bg-neutral-100 p-3">
      <iframe
        ref={iframeRef}
        title="Vista previa del ticket"
        srcDoc={documento}
        onLoad={(e) => {
          const doc = e.currentTarget.contentDocument;
          if (doc) setAlto(altoDelTicketPx(doc));
        }}
        // El ancho es el del papel, no el del dialogo: 80mm son 80mm.
        style={{ width: "80mm", height: alto ? `${alto}px` : "150mm" }}
        className="mx-auto block border-0 bg-white shadow-sm"
      />
    </div>
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
 * Abre el ticket como UNA PESTAÑA PROPIA y deja que ese documento se imprima
 * solo. No se imprime el iframe de la vista previa, y no se imprime la pagina
 * del ERP. Las dos alternativas ya fallaron en papel:
 *
 *  - **Imprimir la pagina del ERP** la sacaba corrida al medio de la hoja: una
 *    hoja impresa arrastra el CSS de la pagina que la contiene, y el <body> del
 *    ERP es `flex min-h-full flex-col`. Esconder a los hermanos arregla QUE se
 *    imprime, no COMO se acomoda lo que queda.
 *  - **Imprimir el iframe** salio un metro de papel en blanco con el encabezado
 *    del navegador arriba. Chrome vuelve a leer el `srcdoc` para armar la
 *    impresion, asi que el <style> con el `@page` que se le agregaba al DOM vivo
 *    no existia para el trabajo de impresion. Que se imprimiera el encabezado
 *    del navegador lo delata: solo aparece si `margin: 0` no se aplico.
 *
 * Un documento de primer nivel, con el `@page` escrito en su propia fuente, es
 * el camino que no depende de ninguna de esas dos cosas.
 *
 * Devuelve la URL del ticket si el navegador bloqueo la ventana, y null si
 * salio bien: un "imprimir" que no hace nada en silencio es una venta que se
 * va sin comprobante.
 */
export function imprimirTicket(
  iframe: HTMLIFrameElement | null,
  boleta: Boleta,
  empresa: string,
  moneda: string,
): string | null {
  // El alto sale de la vista previa, que es el mismo documento al mismo ancho.
  // La pestaña vuelve a medirse igual, pero asi el `@page` correcto ya viaja
  // escrito en la fuente.
  const doc = iframe?.contentDocument;
  const px = doc ? altoDelTicketPx(doc) : 0;
  const altoMm = px > 0 ? Math.ceil(px / PX_POR_MM) + 2 : undefined;

  const html = documentoTicket(datosDeVenta(boleta, empresa, moneda), {
    altoMm,
    autoimprimir: true,
  });
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));

  const ventana = window.open(url, "_blank");
  if (!ventana) return url;
  // La pestaña se cierra sola al terminar; recien ahi se puede soltar el blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return null;
}
