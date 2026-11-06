"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MAX_ALT_LENGTH,
  MAX_STRIP_PHOTOS,
  STRIP_LIMIT_ERROR,
  type StripMoveDirection,
} from "@/lib/domain/strip";
import { redimensionar } from "@/lib/redimensionar-imagen";
import {
  deleteStripPhotoAction,
  moveStripPhotoAction,
  updateStripPhotoAltAction,
  uploadStripPhotoAction,
} from "./actions";

/** Una foto ya resuelta en el servidor, en el orden de la tira. */
export type StripPhotoView = {
  id: string;
  /** "" cuando el almacenamiento no esta configurado. */
  url: string;
  width: number;
  height: number;
  alt: string | null;
};

export function StripManager(props: {
  photos: StripPhotoView[];
  storageConfigured: boolean;
}) {
  const { photos, storageConfigured } = props;
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<{ id: string; position: number } | null>(
    null,
  );
  const [removing, setRemoving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploading = progress !== null;
  const room = Math.max(MAX_STRIP_PHOTOS - photos.length, 0);

  /** De a una y en el orden elegido: cada foto se achica en el navegador y va
   *  en su propio server action, por el tope de 1MB de cada uno. Se suman al
   *  final de la tira. */
  async function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0 || uploading) return;
    const batch = files.slice(0, room);
    if (batch.length < files.length) {
      toast.error(
        `La tira admite hasta ${MAX_STRIP_PHOTOS} fotos: se ${room === 1 ? "sube solo la primera" : `suben solo las primeras ${room}`}.`,
      );
    }

    setProgress({ done: 0, total: batch.length });
    let added = 0;
    for (const [index, file] of batch.entries()) {
      try {
        let resized: File;
        try {
          resized = await redimensionar(file);
        } catch {
          // HEIC de iPhone en Chrome y formatos que el navegador no sabe leer.
          toast.error(
            `${file.name}: no se pudo leer la imagen. Probá con JPG o PNG.`,
          );
          continue;
        }
        const formData = new FormData();
        formData.set("file", resized);
        const result = await uploadStripPhotoAction(formData);
        if (result.ok) {
          added++;
        } else {
          toast.error(`${file.name}: ${result.error}`);
          // Llena (otra pestaña, otro admin): las que siguen fallarian igual.
          if (result.error === STRIP_LIMIT_ERROR) break;
        }
      } catch {
        // Tambien cae aca una foto que, aun achicada, pasa el tope de 1MB que
        // Next le pone al cuerpo de un server action.
        toast.error(
          `${file.name}: no se pudo subir. Probá de nuevo o con una más liviana.`,
        );
      } finally {
        setProgress({ done: index + 1, total: batch.length });
      }
    }

    setProgress(null);
    if (inputRef.current) inputRef.current.value = "";
    if (added > 0) {
      toast.success(
        added === 1
          ? "Foto agregada a la tira."
          : `${added} fotos agregadas a la tira.`,
      );
    }
  }

  async function move(id: string, direction: StripMoveDirection) {
    if (busyId) return;
    setBusyId(id);
    const result = await moveStripPhotoAction(id, direction);
    setBusyId(null);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  async function confirmRemove() {
    if (!toRemove || removing) return;
    setRemoving(true);
    const result = await deleteStripPhotoAction(toRemove.id);
    setRemoving(false);
    setToRemove(null);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fotos</CardTitle>
        <CardDescription>
          Se achican solas antes de subir, así que podés usar las del celular.
          La descripción es opcional: la leen los lectores de pantalla y los
          buscadores.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        {storageConfigured ? (
          <div className="grid gap-2 border-b pb-4">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) => void handleFiles(event)}
              disabled={uploading || room === 0}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground"
              aria-label="Agregar fotos a la tira"
              aria-describedby="tira-cupo"
            />
            {/* aria-live: el avance de la subida se anuncia solo. */}
            <p
              id="tira-cupo"
              aria-live="polite"
              className="cifras text-xs text-muted-foreground"
            >
              {progress
                ? `Subiendo ${Math.min(progress.done + 1, progress.total)} de ${progress.total}…`
                : `${photos.length} de ${MAX_STRIP_PHOTOS} fotos. ${
                    room === 0
                      ? "La tira está llena: quitá una para subir otra."
                      : "Las nuevas se suman al final."
                  }`}
            </p>
          </div>
        ) : (
          <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
            Para subir fotos falta configurar el almacenamiento (SUPABASE_URL /
            SUPABASE_SECRET_KEY).
          </p>
        )}

        {photos.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Todavía no hay fotos en la tira.
          </p>
        ) : (
          <ol className="grid gap-3">
            {photos.map((photo, index) => {
              const position = index + 1;
              const busy = busyId === photo.id;
              return (
                <li
                  key={photo.id}
                  className="flex flex-wrap items-start gap-3 rounded-md border p-3"
                >
                  <span className="cifras w-5 shrink-0 pt-1 text-right text-sm text-muted-foreground">
                    {position}
                  </span>
                  {/* A su proporcion, como la va a mostrar la web, en un lugar
                      de ancho fijo para que la columna de al lado no baile; el
                      tope solo recorta las muy apaisadas en esta lista. */}
                  <div className="flex h-24 w-32 shrink-0 justify-center">
                    <div
                      className="relative h-full max-w-full overflow-hidden rounded-md border bg-muted"
                      style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
                    >
                      {photo.url ? (
                        <Image
                          src={photo.url}
                          alt=""
                          fill
                          sizes="128px"
                          className="object-cover"
                        />
                      ) : null}
                    </div>
                  </div>
                  {/* min-w-56: en un celular no entra al lado de la foto y
                      baja entera abajo, en vez de quedar en una franja. */}
                  <div className="grid min-w-56 flex-1 gap-2">
                    {/* El key con la descripcion guardada rearma el campo
                        cuando cambia en el servidor (recortada, por ejemplo). */}
                    <AltForm
                      key={`${photo.id}:${photo.alt ?? ""}`}
                      photoId={photo.id}
                      position={position}
                      saved={photo.alt}
                    />
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Subir la foto ${position}`}
                        disabled={index === 0 || busy}
                        onClick={() => void move(photo.id, "up")}
                      >
                        <ChevronUp className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Bajar la foto ${position}`}
                        disabled={index === photos.length - 1 || busy}
                        onClick={() => void move(photo.id, "down")}
                      >
                        <ChevronDown className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Quitar la foto ${position}`}
                        disabled={busy}
                        onClick={() => setToRemove({ id: photo.id, position })}
                      >
                        Quitar
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>

      <AlertDialog
        open={toRemove !== null}
        onOpenChange={(open) => {
          if (!open && !removing) setToRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quitar la foto {toRemove?.position}</AlertDialogTitle>
            <AlertDialogDescription>
              Sale de la tira de la web y se borra el archivo. Para volver a
              ponerla hay que subirla de nuevo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removing}
              onClick={(event) => {
                // Se cierra cuando termina y no al hacer clic, para que no se
                // pueda pedir dos veces mientras el borrado esta en camino.
                event.preventDefault();
                void confirmRemove();
              }}
            >
              {removing ? "Quitando…" : "Quitar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/**
 * La descripcion corta de una foto: va al `alt` de la web. La validacion que
 * manda es la del servidor (`stripAltSchema`); el `maxLength` solo evita
 * tipear de mas.
 */
function AltForm(props: {
  photoId: string;
  position: number;
  saved: string | null;
}) {
  const { photoId, position, saved } = props;
  const [value, setValue] = useState(saved ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = `tira-alt-${photoId}`;
  const unchanged = value.trim() === (saved ?? "");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || unchanged) return;
    setSaving(true);
    setError(null);
    const result = await updateStripPhotoAltAction(
      photoId,
      new FormData(event.currentTarget),
    );
    setSaving(false);
    if (result.ok) toast.success(result.message);
    else setError(result.error);
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-2">
      <Label htmlFor={inputId}>
        Descripción corta<span className="sr-only"> de la foto {position}</span>
      </Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={inputId}
          name="alt"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={MAX_ALT_LENGTH}
          autoComplete="off"
          placeholder="Ej: Mate de calabaza con bombilla de alpaca"
          aria-invalid={error !== null}
          className="min-w-0 flex-1 basis-48"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="h-8"
          disabled={saving || unchanged}
        >
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
