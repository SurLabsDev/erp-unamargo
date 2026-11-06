// Solo navegador: usa `createImageBitmap` y un canvas. Lo comparten las fotos
// de producto, la imagen de los pop-ups y las fotos de la tira, que suben por
// el mismo camino.

const LADO_MAX = 1600;
const CALIDAD = 0.82;

/**
 * Hasta este peso se manda tal cual el PNG que devuelve un navegador sin WebP
 * (ver `redimensionar`). Next corta el cuerpo de un server action en 1MB
 * (next.config.ts no cambia `serverActions.bodySizeLimit`); el margen es para
 * el resto del pedido.
 */
const TOPE_PNG = 900 * 1024;

const EXTENSION: Record<string, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
};

function aBlob(canvas: HTMLCanvasElement, tipo: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, tipo, CALIDAD));
}

/**
 * Redimensiona en el NAVEGADOR antes de subir.
 *
 * No es una optimizacion: Vercel corta el cuerpo del request en 4.5MB y
 * responde FUNCTION_PAYLOAD_TOO_LARGE antes de ejecutar el server action, asi
 * que una foto de celular (3-5MB) fallaria justo en el caso normal. A 1600px y
 * WebP queda en ~200KB, que ademas es el tamano que la web va a necesitar.
 *
 * WebP no lo codifican todos. WebKit -Safari, y TODO navegador de iPhone, que
 * por dentro es Safari- no sabe hacer WebP desde un canvas y, en vez de fallar,
 * devuelve un PNG. Medido el 06/11/2026 con la misma foto de 1280x1600: 160KB
 * en WebP desde Chrome, 2.7MB en PNG desde WebKit. Eso no pasa el tope de 1MB
 * de un server action, asi que desde un iPhone no subia ninguna foto. Por eso,
 * si lo que vuelve no es WebP y pesa de mas, se pide JPEG, que lo codifican
 * todos (430KB la misma foto). Un PNG liviano se deja como esta, porque
 * conserva la transparencia. Y el archivo sale con su tipo real: antes un PNG
 * viajaba con la etiqueta de WebP.
 */
export async function redimensionar(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const ancho = Math.round(bitmap.width * escala);
  const alto = Math.round(bitmap.height * escala);

  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("El navegador no pudo procesar la imagen.");
  ctx.drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close();

  let blob = await aBlob(canvas, "image/webp");
  if (blob && blob.type !== "image/webp" && blob.size > TOPE_PNG) {
    // JPEG no tiene transparencia y lo transparente saldria negro: se pinta
    // blanco DETRAS de lo ya dibujado.
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, ancho, alto);
    blob = await aBlob(canvas, "image/jpeg");
  }

  const extension = blob ? EXTENSION[blob.type] : undefined;
  if (!blob || !extension) {
    throw new Error("El navegador no pudo procesar la imagen.");
  }
  return new File([blob], `foto.${extension}`, { type: blob.type });
}
