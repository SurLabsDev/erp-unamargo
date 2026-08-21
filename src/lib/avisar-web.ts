/**
 * Le avisa a la web publica que el catalogo cambio, para que regenere su
 * pagina ahora y no dentro de cinco minutos.
 *
 * Tres decisiones que importan:
 *
 * 1. **Nunca rompe el guardado.** Si la web no contesta, si el secreto esta
 *    mal o si no hay red, el movimiento o la ficha ya se guardaron igual: esto
 *    corre despues y se traga cualquier error. La base es la fuente de verdad;
 *    la web es una copia que se pone al dia sola por tiempo.
 *
 * 2. **Se espera la respuesta** en vez de dispararla y olvidarse. En una
 *    funcion serverless, una promesa sin await se corta cuando la respuesta
 *    sale, asi que "disparar y olvidar" pierde avisos de forma intermitente,
 *    que es peor que no tenerlos. Cuesta unas decimas en el guardado.
 *
 * 3. **Sin configurar, no hace nada.** Una instancia sin web publica -o el
 *    entorno local- no tiene por que fallar ni loguear ruido.
 */
export async function avisarALaWeb(): Promise<void> {
  const url = process.env.WEB_REVALIDATE_URL;
  const secreto = process.env.WEB_REVALIDATE_SECRET;
  if (!url || !secreto) return;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-revalidar-secreto": secreto },
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[avisar-web] la web contestó ${res.status}`);
    }
  } catch (error) {
    console.warn(
      `[avisar-web] no se pudo avisar: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
