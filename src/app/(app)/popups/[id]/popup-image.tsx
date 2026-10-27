"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { redimensionar } from "@/lib/redimensionar-imagen";
import { removePopupImageAction, uploadPopupImageAction } from "../actions";

/** Una sola imagen por pop-up. Sube por el mismo camino que las fotos de
 *  producto: se achica en el navegador y despues va por server action. */
export function PopupImage(props: {
  popupId: string;
  url: string | null;
  storageConfigured: boolean;
}) {
  const { popupId, url, storageConfigured } = props;
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function resetInput() {
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || uploading) return;
    setUploading(true);

    let resized: File;
    try {
      resized = await redimensionar(file);
    } catch {
      // HEIC de iPhone y formatos que el navegador no sabe decodificar.
      toast.error(`${file.name}: no se pudo leer la imagen. Probá con JPG o PNG.`);
      setUploading(false);
      resetInput();
      return;
    }

    try {
      const formData = new FormData();
      formData.set("file", resized);
      const result = await uploadPopupImageAction(popupId, formData);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    } catch {
      // Tambien cae aca una imagen que, aun achicada, pasa el tope de 1MB que
      // Next le pone al cuerpo de un server action: reintentar no la arregla.
      toast.error(
        "No se pudo subir la imagen. Probá de nuevo o con una más liviana.",
      );
    } finally {
      setUploading(false);
      resetInput();
    }
  }

  async function handleRemove() {
    if (removing) return;
    setRemoving(true);
    const result = await removePopupImageAction(popupId);
    setRemoving(false);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Imagen</CardTitle>
        <CardDescription>
          Opcional. Se achica sola antes de subir, así que podés usar una del
          celular. Subir otra reemplaza la que hay.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {url ? (
          <div className="grid gap-2">
            <div className="relative aspect-video w-full max-w-md overflow-hidden rounded-md border bg-muted">
              <Image
                src={url}
                alt=""
                fill
                sizes="(min-width: 640px) 448px, 90vw"
                className="object-contain"
              />
            </div>
            <div>
              <Button
                variant="ghost"
                size="xs"
                disabled={removing || uploading}
                onClick={() => void handleRemove()}
              >
                Quitar imagen
              </Button>
            </div>
          </div>
        ) : (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Este pop-up no tiene imagen.
          </p>
        )}

        {storageConfigured ? (
          <div className="flex items-center gap-3 border-t pt-4">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => void handleFile(event)}
              disabled={uploading || removing}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground"
              aria-label={url ? "Reemplazar la imagen" : "Agregar una imagen"}
            />
            {uploading ? (
              <span className="shrink-0 text-sm text-muted-foreground">
                Subiendo…
              </span>
            ) : null}
          </div>
        ) : (
          <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
            Para subir imágenes falta configurar el almacenamiento
            (SUPABASE_URL / SUPABASE_SECRET_KEY).
          </p>
        )}
      </CardContent>
    </Card>
  );
}
