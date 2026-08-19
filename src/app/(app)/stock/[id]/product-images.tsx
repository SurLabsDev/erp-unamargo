"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  deleteProductImageAction,
  setPrimaryProductImageAction,
  uploadProductImageAction,
} from "../actions";

export type ImagenProducto = { id: string; url: string; esPrincipal: boolean };

const LADO_MAX = 1600;

/**
 * Redimensiona en el NAVEGADOR antes de subir.
 *
 * No es una optimizacion: Vercel corta el cuerpo del request en 4.5MB y
 * responde FUNCTION_PAYLOAD_TOO_LARGE antes de ejecutar el server action, asi
 * que una foto de celular (3-5MB) fallaria justo en el caso normal. A 1600px y
 * WebP queda en ~200KB, que ademas es el tamano que la web va a necesitar.
 */
async function redimensionar(file: File): Promise<File> {
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

export function ProductImages(props: {
  productId: string;
  imagenes: ImagenProducto[];
  puedeEditar: boolean;
  storageConfigurado: boolean;
}) {
  const { productId, imagenes, puedeEditar, storageConfigurado } = props;
  const [subiendo, setSubiendo] = useState(false);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0 || subiendo) return;
    setSubiendo(true);
    let ok = 0;
    for (const file of files) {
      try {
        const chica = await redimensionar(file);
        const formData = new FormData();
        formData.set("file", chica);
        const result = await uploadProductImageAction(productId, formData);
        if (result.ok) ok++;
        else toast.error(`${file.name}: ${result.error}`);
      } catch {
        // HEIC de iPhone y formatos que el navegador no sabe decodificar.
        toast.error(
          `${file.name}: no se pudo leer la imagen. Probá con JPG o PNG.`,
        );
      }
    }
    setSubiendo(false);
    if (inputRef.current) inputRef.current.value = "";
    if (ok > 0)
      toast.success(ok === 1 ? "Foto agregada." : `${ok} fotos agregadas.`);
  }

  async function eliminar(id: string) {
    if (ocupada) return;
    setOcupada(id);
    const result = await deleteProductImageAction(id);
    setOcupada(null);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  async function hacerPrincipal(id: string) {
    if (ocupada) return;
    setOcupada(id);
    const result = await setPrimaryProductImageAction(id);
    setOcupada(null);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fotos</CardTitle>
        <CardDescription>
          La principal es la que la web muestra en el listado. Se achican solas
          antes de subir, así que podés usar las del celular.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {imagenes.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Este producto todavía no tiene fotos.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {imagenes.map((imagen) => (
              <li key={imagen.id} className="grid gap-1.5">
                <div className="relative aspect-square overflow-hidden rounded-md border bg-muted">
                  <Image
                    src={imagen.url}
                    alt=""
                    fill
                    sizes="(min-width: 640px) 160px, 45vw"
                    className="object-cover"
                  />
                  {imagen.esPrincipal ? (
                    <Badge className="absolute top-1 left-1">Principal</Badge>
                  ) : null}
                </div>
                {puedeEditar ? (
                  <div className="flex justify-between gap-1">
                    {!imagen.esPrincipal ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={ocupada === imagen.id}
                        onClick={() => void hacerPrincipal(imagen.id)}
                      >
                        Hacer principal
                      </Button>
                    ) : (
                      <span />
                    )}
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={ocupada === imagen.id}
                      onClick={() => void eliminar(imagen.id)}
                    >
                      Eliminar
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {puedeEditar && storageConfigurado ? (
          <div className="flex items-center gap-3 border-t pt-4">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) => void handleFiles(event)}
              disabled={subiendo}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground"
              aria-label="Agregar fotos"
            />
            {subiendo ? (
              <span className="shrink-0 text-sm text-muted-foreground">
                Subiendo…
              </span>
            ) : null}
          </div>
        ) : null}

        {puedeEditar && !storageConfigurado ? (
          <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
            Para subir fotos falta configurar el almacenamiento (SUPABASE_URL /
            SUPABASE_SECRET_KEY).
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
