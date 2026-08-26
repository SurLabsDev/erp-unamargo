/**
 * El ticket de 80mm, armado como un DOCUMENTO ENTERO y no como un pedazo de
 * la pantalla.
 *
 * Esa es la decision de fondo, y es la que arregla el bug que la version
 * anterior no pudo arreglar en tres intentos: la boleta salia corrida al medio
 * de la hoja. El motivo es que vivia dentro del ERP, y una pagina impresa
 * arrastra TODO el CSS de la pagina que la contiene. El <body> del ERP es
 * `flex min-h-full flex-col`, asi que al imprimir el navegador seguia
 * aplicando ese layout: por mas que se escondiera todo lo demas, la boleta
 * quedaba estirada y centrada dentro de una hoja que el driver define, no
 * nosotros. Pelear eso con `!important` es la misma pelea que ya se perdio con
 * el cajon del carrito en Safari.
 *
 * Aca el ticket es un `<iframe>` con su propio documento: html y body miden
 * 80mm, no hay una sola regla del ERP adentro, y lo que se ve en pantalla es
 * literalmente el mismo documento que se manda a la impresora.
 *
 * El diseño y el CSS son el template que trajo el cliente
 * (`ticket_unamargo_80mm.html`), con tres cambios anotados donde ocurren:
 * el `min-height: 250mm`, el `break-after: page` y el alto del `@page`.
 *
 * Reglas del papel termico que explican por que esta todo en milimetros: el
 * papel existe en el mundo fisico y un pixel no le dice nada a la impresora.
 * Y no hay grises: el cabezal QUEMA el papel en vez de depositar tinta, asi
 * que un gris sale como una trama sucia. Todo negro puro sobre blanco.
 */

/** Una linea del ticket. */
export type ItemTicket = {
  nombre: string;
  cantidad: number;
  /** Precio unitario, tal como quedo registrado. */
  precio: string | number;
};

export type DatosTicket = {
  /** "Venta". Va arriba de todo y en la columna del numero. */
  tipo: string;
  /** "#000123" */
  numero: string;
  /** "26 AGO 2026" */
  fecha: string;
  /** "15:30" */
  hora?: string;
  /** Quien cobro. */
  cajero?: string;
  empresa: string;
  /** Codigo ISO de la moneda de la instancia ("UYU"). */
  moneda: string;
  items: ItemTicket[];
  /** Envio: si es 0 o falta, la fila no se dibuja. */
  envio?: number;
  envioEtiqueta?: string;
  /** Con cuanto pago y cuanto se le devolvio. Si faltan, el bloque no se
   *  dibuja: un ticket que dice "Cambio $ 0" porque nadie cargo con cuanto
   *  pagaron esta inventando un dato. */
  pagoMetodo?: string;
  pago?: number;
  /** Lo que se imprime en el recuadro con borde. */
  aviso?: { titulo: string; detalle: string };
  /** Codigo de barras Code 128. Corto: a 203 dpi uno largo no se lee. */
  codigoBarras?: string;
};

/**
 * Los datos de la marca. Es el UNICO lugar de todo el ticket que sabe que el
 * cliente es Un Amargo: el resto sale de la configuracion de la instancia. Para
 * otro cliente se cambia este bloque y el ticket queda hecho.
 */
const MARCA = {
  lema: ["un amargo,", "sin vueltas,", "sin azúcar."],
  descripcion: "Mates, bombillas y accesorios en Montevideo.",
  gracias: "Gracias por elegirnos.",
  instagram: "@unamargo_",
  telefono: "098 702 638",
  lugar: "Montevideo, Uruguay",
  /** El mismo isotipo que usa la web publica y el resto del ERP. */
  logo: '<svg class="brand__mark" viewBox="0 0 8256 7030" fill="currentColor" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Un Amargo"><path d="M231 568.104C722.281 434.795 779.775 708.583 1260.46 1308.71C1549.24 1416.81 1649.63 1531.52 1625.83 1913.55C1851.2 2129.57 1856.88 2247.24 1949.23 2543.08C2001.47 2690.95 2010 2793.07 2035.63 2924.46C2035.3 2938.06 2134.65 3773.31 2134.71 3773.88V4623.29C2134.71 4893.33 2191.14 5092.84 2303.99 5221.81C2420.87 5346.76 2584.11 5409.23 2793.69 5409.23C2938.79 5409.23 3067.76 5379 3180.61 5318.54C3293.47 5254.06 3382.14 5157.33 3446.62 5028.35C3511.11 4895.35 3543.35 4730.1 3543.35 4532.61C3543.35 3264.32 3987.14 3015.38 4881.9 3015.38C4232.85 3579.44 4118.53 5318.54 5087.97 6177.03H3591.72V5795.92C3502.75 5901.18 3395.95 5987.91 3271.3 6056.12C3061.72 6168.97 2831.98 6225.39 2582.09 6225.39C2312.05 6225.39 2070.23 6173 1856.61 6068.21C1647.03 5963.42 1483.8 5804.21 1366.92 5590.6C1250.03 5372.95 1191.59 5096.87 1191.59 4762.34L1314 3234.24C1333.59 2900.93 1176.55 2409.5 1041.08 2093.77C762.856 1968.86 714.738 1845.23 784.329 1545.71L231 568.104Z"></path><path d="M7742.17 3362.67C9380.18 7296.92 3294.86 7056.75 4987.41 3362.67C6033.4 3619.39 6644.56 3620.22 7742.17 3362.67ZM7397.48 2832C7385.45 2984.99 7407.52 3053.74 7532.24 3127.07C6621.47 3327.26 6110.83 3327.41 5200.06 3127.07C5347.36 3048.85 5384.17 2981.89 5389.65 2832C6139.29 3002.67 6587.05 3001.46 7397.48 2832Z"></path></svg>',
} as const;

const MESES = [
  "ENE", "FEB", "MAR", "ABR", "MAY", "JUN",
  "JUL", "AGO", "SET", "OCT", "NOV", "DIC",
];

/** "2026-08-26" -> "26 AGO 2026". Sin zonas horarias: es un `date` de la base,
 *  no un instante. */
export function fechaTicket(iso: string): string {
  const [anio, mes, dia] = iso.split("-");
  return `${dia} ${MESES[Number(mes) - 1] ?? mes} ${anio}`;
}

/** "#000123" a partir del id del movimiento de caja. */
export function numeroTicket(id: number): string {
  return `#${String(id).padStart(6, "0")}`;
}

/**
 * Plata, con decimales SOLO si los tiene.
 *
 * El template original redondeaba siempre a entero, que es lo correcto para
 * precios en pesos enteros y una mentira para un precio de 1.990,50: saldria
 * 1.991 y el papel no coincidiria con la caja.
 */
function plata(valor: number, moneda: string): string {
  const decimales = Number.isInteger(valor) ? 0 : 2;
  return new Intl.NumberFormat("es-UY", {
    style: "currency",
    currency: moneda,
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(valor);
}

/** El nombre de un producto puede traer `&` o `<`. */
function esc(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- Code 128 --------------------------------------------------------------
// Portado tal cual del template del cliente. Se dibuja como SVG y no como
// fuente de codigo de barras a proposito: una fuente que no este instalada en
// la maquina del local sale como texto y el ticket queda inservible.

const CODE128 = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112",
];

function codigoDeBarras(valor: string): string {
  // Code 128 solo habla ASCII imprimible.
  const texto = valor.replace(/[^\x20-\x7E]/g, "");
  if (!texto) return "";

  const codigos = [104]; // START B
  let checksum = 104;
  for (let i = 0; i < texto.length; i += 1) {
    const codigo = texto.charCodeAt(i) - 32;
    codigos.push(codigo);
    checksum += codigo * (i + 1);
  }
  codigos.push(checksum % 103);
  codigos.push(106); // STOP

  const silencio = 10; // zona muda: sin esto el lector no engancha
  let x = silencio;
  const barras: string[] = [];
  for (const codigo of codigos) {
    const patron = CODE128[codigo];
    let negra = true;
    for (const digito of patron) {
      const ancho = Number(digito);
      if (negra) {
        barras.push(
          `<rect x="${x}" y="0" width="${ancho}" height="40" fill="#000"></rect>`,
        );
      }
      x += ancho;
      negra = !negra;
    }
  }
  const ancho = x + silencio;
  return `<svg viewBox="0 0 ${ancho} 40" preserveAspectRatio="none" role="img" aria-label="Código de barras ${esc(texto)}">${barras.join("")}</svg>`;
}

// --- El documento ----------------------------------------------------------

/**
 * El CSS del ticket, con TODO colgando de `.ticket`.
 *
 * `pre` es lo que va adelante: vacio para el documento suelto de la vista
 * previa, y `.impresion-ticket ` para la copia que se incrusta en la pagina del
 * ERP. Una sola fuente de estilos para las dos, porque tener dos era el pecado
 * original de esto: el que se veia estaba bien y el que salia no.
 *
 * Nada toca `html` ni `body`: eso es lo que permite incrustarlo sin pisarle el
 * layout al ERP.
 */
function cssTicket(pre: string): string {
  return `
${pre}.ticket, ${pre}.ticket * { box-sizing: border-box; }

${pre}.ticket {
  width: 80mm;
  padding: 7.5mm 7mm 10mm;
  margin: 0;
  color: #000;
  background: #fff;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 8pt;
  line-height: 1.2;
  overflow: hidden;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

${pre}.ticket .brand { display: flex; align-items: center; gap: 2.5mm; margin: 0 0 7mm; }
${pre}.ticket .brand__mark { display: block; width: 8.6mm; height: auto; flex: 0 0 auto; }
${pre}.ticket .brand__name { font-size: 11.2pt; font-weight: 700; line-height: 1; }

${pre}.ticket .eyebrow {
  margin: 0;
  font-size: 6.1pt;
  font-weight: 700;
  letter-spacing: 0.25pt;
  text-transform: uppercase;
}

${pre}.ticket .hero {
  margin: 3.4mm 0 5mm;
  font-size: 21.5pt;
  font-weight: 700;
  line-height: 0.98;
  letter-spacing: -0.2pt;
}

${pre}.ticket .intro { margin: 0 0 6mm; font-size: 7.4pt; line-height: 1.3; }

${pre}.ticket .rule { height: 0; margin: 0; border: 0; border-top: 0.25mm solid #000; }

${pre}.ticket .meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 5mm;
  row-gap: 2mm;
  margin: 5mm 0 2.5mm;
}
${pre}.ticket .meta__value { margin-top: 1mm; font-size: 8.7pt; font-weight: 700; }
${pre}.ticket .meta__detail { grid-column: 1 / -1; font-size: 6.8pt; white-space: nowrap; }

${pre}.ticket .items { margin-top: 6mm; }
${pre}.ticket .items__heading { margin-bottom: 4.3mm; }

${pre}.ticket .item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 3mm;
  margin-bottom: 4.3mm;
  break-inside: avoid;
}
${pre}.ticket .item__name,
${pre}.ticket .item__amount { font-size: 8.6pt; font-weight: 700; line-height: 1.15; }
${pre}.ticket .item__amount { white-space: nowrap; text-align: right; }
${pre}.ticket .item__detail { grid-column: 1 / -1; margin-top: 1.2mm; font-size: 6.8pt; }

${pre}.ticket .summary {
  margin-top: 1.5mm;
  padding-top: 3.4mm;
  border-top: 0.25mm solid #000;
}
${pre}.ticket .summary__row,
${pre}.ticket .payment__row {
  display: flex;
  justify-content: space-between;
  gap: 4mm;
  margin-bottom: 2.2mm;
  font-size: 7.5pt;
}

${pre}.ticket .total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 12mm;
  margin: 5.2mm 0 4.7mm;
  padding: 2.5mm 4mm;
  color: #fff;
  background: #000;
  border-radius: 8mm;
  break-inside: avoid;
  /* Chrome trae "Graficos de fondo" APAGADO por defecto, y sin esto la pildora
     saldria como texto blanco sobre papel blanco: el total, invisible. */
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
${pre}.ticket .total__label { font-size: 10.8pt; font-weight: 700; }
${pre}.ticket .total__amount { font-size: 13.5pt; font-weight: 700; white-space: nowrap; }

${pre}.ticket .payment__row--strong { font-size: 8.2pt; font-weight: 700; }

${pre}.ticket .disclaimer {
  margin: 6mm 0 5.5mm;
  padding: 2.2mm 3mm;
  border: 0.25mm solid #000;
  border-radius: 5mm;
  text-align: center;
  break-inside: avoid;
}
${pre}.ticket .disclaimer__title { font-size: 6.7pt; font-weight: 700; }
${pre}.ticket .disclaimer__subtitle { margin-top: 0.8mm; font-size: 6.4pt; }

${pre}.ticket .barcode { margin: 0 auto 5.5mm; text-align: center; break-inside: avoid; }
${pre}.ticket .barcode svg { display: block; width: 56mm; height: 9mm; margin: 0 auto 1.5mm; }
${pre}.ticket .barcode__text {
  font-family: Consolas, "Courier New", monospace;
  font-size: 5.8pt;
  white-space: nowrap;
}

${pre}.ticket .footer { padding-top: 4.8mm; border-top: 0.25mm solid #000; }
${pre}.ticket .footer__thanks { margin: 0 0 2.5mm; font-size: 8.6pt; font-weight: 700; }
${pre}.ticket .footer__line { margin: 0 0 1.5mm; font-size: 6.8pt; }
`;
}

/**
 * Los estilos de la copia que se incrusta en la pagina del ERP para imprimir.
 *
 * No trae `@page` ni reglas de `html`/`body`: de eso se encarga el bloque de
 * impresion de `globals.css`, que es el que tiene que apagar el resto del ERP.
 */
export function estilosIncrustados(): string {
  return cssTicket(".impresion-ticket ");
}

/**
 * El cuerpo del ticket: `<main class="ticket">`, sin documento alrededor.
 *
 * Lo usan los dos destinos -la vista previa, que lo mete en un documento
 * suelto, y la copia que se imprime, que lo incrusta en la pagina del ERP- para
 * que sea imposible que difieran.
 */
export function cuerpoTicket(d: DatosTicket): string {
  const items = d.items.map((i) => ({
    nombre: i.nombre,
    cantidad: i.cantidad,
    unitario: Number(i.precio),
    total: Number(i.precio) * i.cantidad,
  }));

  const subtotal = items.reduce((suma, i) => suma + i.total, 0);
  const envio = Number(d.envio ?? 0);
  const total = subtotal + envio;
  const pago = d.pago;
  const vuelto = pago === undefined ? undefined : Math.max(0, pago - total);

  const unidades = items.reduce((suma, i) => suma + i.cantidad, 0);
  const detalle = [d.hora, d.cajero ? `Atendió ${d.cajero}` : ""]
    .filter(Boolean)
    .join("  ·  ");

  const filasItems = items
    .map(
      (i) => `<article class="item">
        <div class="item__name">${esc(i.nombre)}</div>
        <div class="item__amount">${plata(i.total, d.moneda)}</div>
        <div class="item__detail">${i.cantidad} x ${plata(i.unitario, d.moneda)}</div>
      </article>`,
    )
    .join("");

  // La fila de subtotal solo aparece si hay algo que sumarle. Sin envio,
  // subtotal y total son el mismo numero y repetirlo pegado uno arriba del otro
  // es ruido en una columna de 72mm.
  const filasResumen = envio
    ? `<div class="summary__row"><span>Subtotal</span><span>${plata(subtotal, d.moneda)}</span></div>
       <div class="summary__row"><span>${esc(d.envioEtiqueta ?? "Envío")}</span><span>${plata(envio, d.moneda)}</span></div>`
    : "";

  const bloquePago =
    pago === undefined
      ? ""
      : `<section class="payment">
          <div class="payment__row">
            <span>Pago en ${esc((d.pagoMetodo ?? "efectivo").toLowerCase())}</span>
            <span>${plata(pago, d.moneda)}</span>
          </div>
          <div class="payment__row payment__row--strong">
            <span>Cambio</span><span>${plata(vuelto ?? 0, d.moneda)}</span>
          </div>
        </section>`;

  const bloqueAviso = d.aviso
    ? `<section class="disclaimer">
        <div class="disclaimer__title">${esc(d.aviso.titulo)}</div>
        <div class="disclaimer__subtitle">${esc(d.aviso.detalle)}</div>
      </section>`
    : "";

  const svgBarras = d.codigoBarras ? codigoDeBarras(d.codigoBarras) : "";
  const bloqueBarras = svgBarras
    ? `<section class="barcode">
        ${svgBarras}
        <div class="barcode__text">${esc(d.codigoBarras ?? "")}</div>
      </section>`
    : "";

  return `<main class="ticket">
  <header class="brand">
    ${MARCA.logo}
    <div class="brand__name">${esc(d.empresa)}</div>
  </header>

  <p class="eyebrow">${esc(d.tipo)}</p>
  <h1 class="hero">${MARCA.lema.map(esc).join("<br>")}</h1>
  <p class="intro">${esc(MARCA.descripcion)}</p>

  <hr class="rule">

  <section class="meta">
    <div>
      <p class="eyebrow">${esc(d.tipo)}</p>
      <div class="meta__value">${esc(d.numero)}</div>
    </div>
    <div>
      <p class="eyebrow">Fecha</p>
      <div class="meta__value">${esc(d.fecha)}</div>
    </div>
    ${detalle ? `<div class="meta__detail">${esc(detalle)}</div>` : ""}
  </section>

  <section class="items">
    <p class="eyebrow items__heading">Productos  ${unidades}</p>
    <div>${filasItems}</div>
  </section>

  <section class="summary">${filasResumen}</section>

  <section class="total">
    <span class="total__label">Total</span>
    <span class="total__amount">${plata(total, d.moneda)}</span>
  </section>

  ${bloquePago}
  ${bloqueAviso}
  ${bloqueBarras}

  <footer class="footer">
    <p class="footer__thanks">${esc(MARCA.gracias)}</p>
    <p class="footer__line">${esc(`${MARCA.instagram}  ·  ${MARCA.telefono}`)}</p>
    <p class="footer__line">${esc(MARCA.lugar)}</p>
  </footer>
</main>`;
}

/**
 * El ticket como documento suelto, para la vista previa.
 *
 * Solo aca aparecen las reglas de `html`/`body` y el `@page`: el papel mide
 * 80mm y el documento tambien. La copia que se imprime NO usa esto -se incrusta
 * en la pagina del ERP y el papel lo define `globals.css`-.
 */
export function documentoTicket(d: DatosTicket): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${esc(d.tipo)} ${esc(d.numero)}</title>
<style>
@page { size: 80mm 250mm; margin: 0; }
html, body { width: 80mm; margin: 0; padding: 0; background: #fff; }
${cssTicket("")}
</style>
</head>
<body>
${cuerpoTicket(d)}
</body>
</html>`;
}
