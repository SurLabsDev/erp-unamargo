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
 * que se manda a la impresora, al ancho real del papel. Antes habia dos
 * renders -uno para la pantalla y otro escondido para imprimir- y eso ya se
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
 * Se imprime el DOCUMENTO DEL IFRAME (`contentWindow.print()`), no la pagina
 * del ERP. Esa es la diferencia entre que salga bien y que salga corrida al
 * medio de la hoja: imprimiendo la pagina del ERP, el navegador aplica el CSS
 * del ERP -empezando por el <body>, que es `flex min-h-full flex-col`- y el
 * ticket termina estirado y centrado dentro de la hoja que define el driver.
 * El iframe tiene su propio documento, donde html y body miden 80mm y no hay
 * una sola regla nuestra.
 *
 * El alto del papel se mide y se escribe aca, en un `@page`, porque el CSS no
 * puede saber cuanto mide un ticket hasta armarlo, y `size: 80mm auto` no es
 * sintaxis valida: el navegador descarta la regla y cae en tamaño carta.
 */
export function imprimirTicket(iframe: HTMLIFrameElement | null) {
  const ventana = iframe?.contentWindow;
  const doc = iframe?.contentDocument;
  if (!ventana || !doc) return;

  const px = altoDelTicketPx(doc);
  if (px > 0) {
    // +2mm de tolerancia de redondeo. La cola para el cortador ya son los 10mm
    // de padding de abajo del ticket: agregar mas es tirar rollo.
    const mm = Math.ceil(px / PX_POR_MM) + 2;
    const id = "hoja-ticket";
    doc.getElementById(id)?.remove();
    const estilo = doc.createElement("style");
    estilo.id = id;
    estilo.textContent = `@page { size: 80mm ${mm}mm; margin: 0; }`;
    doc.head.appendChild(estilo);
  }

  ventana.focus();
  ventana.print();
}
