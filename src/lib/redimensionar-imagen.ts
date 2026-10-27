// Solo navegador: usa `createImageBitmap` y un canvas. Lo comparten las fotos
// de producto y la imagen de los pop-ups, que suben por el mismo camino.

const LADO_MAX = 1600;

/**
 * Redimensiona en el NAVEGADOR antes de subir.
 *
 * No es una optimizacion: Vercel corta el cuerpo del request en 4.5MB y
 * responde FUNCTION_PAYLOAD_TOO_LARGE antes de ejecutar el server action, asi
 * que una foto de celular (3-5MB) fallaria justo en el caso normal. A 1600px y
 * WebP queda en ~200KB, que ademas es el tamano que la web va a necesitar.
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

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.82),
  );
  if (!blob) throw new Error("El navegador no pudo procesar la imagen.");
  return new File([blob], "foto.webp", { type: "image/webp" });
}
