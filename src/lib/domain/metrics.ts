/**
 * Metricas del panel, como funciones puras: entran filas crudas, salen numeros
 * listos para dibujar. Sin base de datos, testeables solas.
 *
 * QUE NO SE PUEDE CALCULAR ACA, y conviene saberlo antes de intentarlo:
 * el ERP registra MOVIMIENTOS DE CAJA, no ventas. `cash_movements` no tiene
 * ninguna referencia a un producto, y `products.price` es de exhibicion y a
 * proposito no alimenta Dinero (PROMPT_ERP.md §6). Por eso no hay -ni puede
 * haber sin cambiar el modelo- ticket promedio, margen, ni producto mas
 * rentable: no existe el concepto de orden ni de costo.
 *
 * Lo que si se puede: leer el libro de stock, que es append-only y confiable.
 */

/** Una salida del deposito. `cantidad` es positiva: el ledger la guarda como
 *  delta negativo y aca ya viene dada vuelta. */
export type Salida = {
  productoId: string;
  cantidad: number;
  fecha: string; // YYYY-MM-DD en la timezone de la instancia
};

export type PuntoSerie = { fecha: string; valor: number };

/**
 * Salidas por dia, con los dias sin movimiento en cero.
 *
 * Rellenar los huecos no es cosmetico: sin eso, un grafico de linea une el
 * lunes con el viernes y dibuja una pendiente suave donde en realidad hubo
 * cuatro dias sin vender nada.
 */
export function salidasPorDia(
  salidas: Salida[],
  desde: string,
  hasta: string,
): PuntoSerie[] {
  const acumulado = new Map<string, number>();
  for (const s of salidas) {
    acumulado.set(s.fecha, (acumulado.get(s.fecha) ?? 0) + s.cantidad);
  }

  const serie: PuntoSerie[] = [];
  const cursor = new Date(`${desde}T00:00:00Z`);
  const fin = new Date(`${hasta}T00:00:00Z`);
  while (cursor <= fin) {
    const iso = cursor.toISOString().slice(0, 10);
    serie.push({ fecha: iso, valor: acumulado.get(iso) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return serie;
}

/**
 * Cobertura: cuantos dias dura el stock al ritmo de salida del periodo.
 *
 * Es la metrica mas accionable que permite este modelo, porque responde "que
 * reponer primero" mejor que el minimo fijo: un producto con 10 unidades que
 * sale 5 por dia esta mas al borde que uno con 3 que sale una por mes.
 *
 * Devuelve null cuando no hubo salidas: sin ritmo no hay prediccion, y poner
 * Infinity daria un orden falso donde lo que hay es falta de datos.
 */
export function diasDeCobertura(
  stockActual: number,
  salidasEnPeriodo: number,
  diasDelPeriodo: number,
): number | null {
  if (salidasEnPeriodo <= 0 || diasDelPeriodo <= 0) return null;
  const porDia = salidasEnPeriodo / diasDelPeriodo;
  return stockActual / porDia;
}

/** Valor del inventario a precio de EXHIBICION, en centavos.
 *
 *  El nombre importa: no es lo que vale la mercaderia -para eso haria falta el
 *  costo, que el ERP no guarda- sino cuanto suma la lista de precios. */
export function valorInventarioCentavos(
  filas: { stock: number; precioCentavos: bigint | null }[],
): bigint {
  let total = 0n;
  for (const f of filas) {
    if (f.precioCentavos === null || f.stock <= 0) continue;
    total += f.precioCentavos * BigInt(f.stock);
  }
  return total;
}

/** Variacion porcentual entre dos periodos. `null` cuando el anterior es cero:
 *  crecer desde cero no es "infinito por ciento", es que antes no habia nada. */
export function variacion(actual: number, anterior: number): number | null {
  if (anterior === 0) return null;
  return ((actual - anterior) / anterior) * 100;
}

/** Reparte un total entre categorias y agrega el porcentaje de cada una.
 *  Ordena de mayor a menor, que es como se lee una torta. */
export function reparto<T extends { etiqueta: string; valor: number }>(
  filas: T[],
): (T & { porcentaje: number })[] {
  const total = filas.reduce((a, f) => a + f.valor, 0);
  return filas
    .map((f) => ({ ...f, porcentaje: total > 0 ? (f.valor / total) * 100 : 0 }))
    .sort((a, b) => b.valor - a.valor);
}

/**
 * Escala del eje vertical: redondea el maximo para arriba a un numero
 * "redondo" y devuelve las marcas.
 *
 * Se redondea a proposito. Si el pico del periodo es 47, un eje que termina en
 * 47 pone la marca de arriba en un numero que no significa nada; terminando en
 * 50 las marcas caen en 0, 25 y 50, que se leen de un vistazo.
 *
 * Con maximo 0 -un periodo sin salidas- igual devuelve una escala usable, para
 * que el grafico se dibuje plano en la base y no se rompa dividiendo por cero.
 */
export function escalaY(maximo: number, marcas = 4): { tope: number; valores: number[] } {
  if (maximo <= 0) return { tope: marcas, valores: Array.from({ length: marcas + 1 }, (_, i) => i) };

  // El paso se busca entre 1, 2, 2.5, 5 y 10 por decada: son los cortes que la
  // gente lee sin pensar. El 2,5 esta porque sin el un pico de 47 con dos
  // marcas obliga a un eje que llega a 100, con la mitad del grafico vacia.
  //
  // Se descartan los pasos que no dan entero: el eje cuenta UNIDADES de
  // producto, y una marca en 2,5 unidades no significa nada.
  const crudo = maximo / marcas;
  const decada = Math.pow(10, Math.floor(Math.log10(crudo)));
  const paso =
    [1, 2, 2.5, 5, 10]
      .map((m) => m * decada)
      .filter((p) => Number.isInteger(p))
      .find((p) => p >= crudo) ?? Math.ceil(crudo);
  const tope = paso * marcas;

  return { tope, valores: Array.from({ length: marcas + 1 }, (_, i) => i * paso) };
}
