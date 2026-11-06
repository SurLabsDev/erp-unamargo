"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import Image from "next/image";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
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
  MIN_SUGGESTED_STRIP_PHOTOS,
  STRIP_LIMIT_ERROR,
  STRIP_NOT_FOUND_ERROR,
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

/** Cuando la action ni siquiera contesta: sin red, o una pestaña abierta desde
 *  antes de un deploy, cuyas actions ya no existen. */
const UNEXPECTED_ERROR = "Ocurrió un error, intentá de nuevo.";

/** El renglon de cupo, que se anuncia solo (aria-live) despues de cada subida. */
function quotaText(count: number): string {
  const total = `${count} de ${MAX_STRIP_PHOTOS} fotos.`;
  if (count >= MAX_STRIP_PHOTOS) {
    return `${total} La tira está llena: quitá una para subir otra.`;
  }
  if (count > 0 && count < MIN_SUGGESTED_STRIP_PHOTOS) {
    return `${total} Conviene que sean al menos ${MIN_SUGGESTED_STRIP_PHOTOS}: con menos, en una pantalla ancha la tira deja un hueco. Las nuevas se suman al final.`;
  }
  return `${total} Las nuevas se suman al final.`;
}

// --- Foco del teclado --------------------------------------------------------
//
// Tres cosas le sacan el foco a quien usa el teclado y lo dejan en <body>, o
// sea, a tabular de nuevo desde arriba de toda la pagina: React saca del DOM y
// vuelve a poner la fila de una foto que baja, un boton que llega al borde (o
// que se deshabilita mientras la action trabaja) pierde el foco, y una foto
// quitada se lleva sus botones. Por eso, despues de mover o de quitar, el foco
// vuelve al mismo control y en el mismo lugar: el mismo boton de la foto que
// se movio, o el de la foto que quedo en el lugar de la que se fue. Si estaba
// en un boton vuelve a un boton, nunca a un campo de texto: en el celular,
// darle el foco a un campo abre el teclado. Los controles se buscan por id.

/** Los controles de una fila que pueden tener el foco. */
type Control = "alt" | "save" | "up" | "down" | "remove";

const controlId = (photoId: string, control: Control) =>
  `tira-${control}-${photoId}`;
const EMPTY_MESSAGE_ID = "tira-vacia";

/** Si ese control no se puede usar, el de al lado: un boton de mover que
 *  llego al borde queda deshabilitado (ahi va al otro, como pide quien la
 *  sigue moviendo), igual que "Guardar" sin nada nuevo. "Quitar" y el campo
 *  estan siempre. */
const FALLBACKS: Record<Control, Control[]> = {
  alt: ["alt"],
  save: ["save", "up", "down", "remove"],
  up: ["up", "down", "remove"],
  down: ["down", "up", "remove"],
  remove: ["remove"],
};

/** Le da el foco a ese elemento si existe y se puede usar. */
function focusById(id: string): boolean {
  const element = document.getElementById(id);
  if (!element) return false;
  if (element instanceof HTMLButtonElement && element.disabled) return false;
  element.focus();
  return true;
}

/** Ese control en la fila de esa foto, o el mas parecido que se pueda usar. */
function focusControl(photoId: string, control: Control): boolean {
  return FALLBACKS[control].some((c) => focusById(controlId(photoId, c)));
}

/** Para cuando la foto que tenia el foco ya no esta: el mismo control en la
 *  que quedo en su lugar, o en la nueva ultima, o el aviso de tira vacia. */
function focusNear(
  photos: readonly StripPhotoView[],
  index: number,
  control: Control,
) {
  const neighbour = photos[Math.min(index, photos.length - 1)];
  if (neighbour) focusControl(neighbour.id, control);
  else focusById(EMPTY_MESSAGE_ID);
}

type PendingMove = { id: string; direction: StripMoveDirection; index: number };

/** Despues de mover: el mismo boton, para poder seguir moviendola, o el otro
 *  si llego al borde. Si ya no esta (la quitaron desde otro lado), el de la
 *  que quedo en su lugar. */
function focusAfterMove(photos: readonly StripPhotoView[], move: PendingMove) {
  if (focusControl(move.id, move.direction)) return;
  focusNear(photos, move.index, move.direction);
}

export function StripManager(props: {
  photos: StripPhotoView[];
  storageConfigured: boolean;
}) {
  const { photos, storageConfigured } = props;
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  // Mover y quitar van en transiciones y no con un estado propio: React no las
  // da por terminadas hasta que llega la lista nueva que trae la respuesta de
  // la action, y las aplica juntas. Cuando `moving` vuelve a false, cada fila
  // ya esta donde va a quedar y se le puede devolver el foco.
  const [moving, startMoving] = useTransition();
  const [movingId, setMovingId] = useState<string | null>(null);
  const [removing, startRemoving] = useTransition();
  const [toRemove, setToRemove] = useState<{
    id: string;
    position: number;
    last: boolean;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingMove = useRef<PendingMove | null>(null);
  const removal = useRef<{ id: string; index: number } | null>(null);
  /** Donde esta el foco del teclado, si esta en una fila de la lista. */
  const focused = useRef<{ photoId: string; control: Control } | null>(null);
  /** La lista que se dibujo la ultima vez, para saber donde estaba una foto
   *  que ya no esta. */
  const shownPhotos = useRef(photos);
  const uploading = progress !== null;
  const room = Math.max(MAX_STRIP_PHOTOS - photos.length, 0);

  useLayoutEffect(() => {
    const before = shownPhotos.current;
    shownPhotos.current = photos;
    if (moving) return;
    const move = pendingMove.current;
    if (move) {
      pendingMove.current = null;
      focusAfterMove(photos, move);
      return;
    }
    // Una foto que se quita con el dialogo la atiende `focusAfterRemoval`,
    // cuando el dialogo termina de cerrarse.
    if (removal.current) return;
    // La foto que tenia el foco desaparecio de la lista: una action la
    // encontro quitada desde otro lado y refresco la pantalla sin ella.
    const last = focused.current;
    const active = document.activeElement;
    if (!last || (active !== null && active !== document.body)) return;
    if (photos.some((photo) => photo.id === last.photoId)) return;
    const index = before.findIndex((photo) => photo.id === last.photoId);
    if (index !== -1) focusNear(photos, index, last.control);
  }, [photos, moving]);

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

  function move(id: string, index: number, direction: StripMoveDirection) {
    if (moving) return;
    setMovingId(id);
    pendingMove.current = { id, direction, index };
    startMoving(async () => {
      try {
        const result = await moveStripPhotoAction(id, direction);
        if (result.ok) toast.success(result.message);
        else toast.error(result.error);
      } catch {
        toast.error(UNEXPECTED_ERROR);
      }
    });
  }

  function askRemove(id: string, index: number) {
    removal.current = { id, index };
    setToRemove({ id, position: index + 1, last: photos.length === 1 });
  }

  function confirmRemove() {
    if (!toRemove || removing) return;
    const { id } = toRemove;
    startRemoving(async () => {
      try {
        const result = await deleteStripPhotoAction(id);
        if (result.ok) toast.success(result.message);
        else toast.error(result.error);
      } catch {
        toast.error(UNEXPECTED_ERROR);
      }
      // Despues de un await, React pide envolverlo de nuevo para que quede en
      // la transicion: asi el dialogo se cierra en la misma pasada que trae la
      // lista nueva, y al devolver el foco (abajo) la fila quitada ya no esta.
      startRemoving(() => setToRemove(null));
    });
  }

  /** Radix le devolveria el foco al "Quitar" que abrio el dialogo, que no
   *  existe mas si la foto se quito, y el foco quedaria en <body>. Va al
   *  "Quitar" de la que quedo en su lugar; si se cancelo, o el borrado no se
   *  hizo, al de la misma foto. */
  function focusAfterRemoval(event: Event) {
    event.preventDefault();
    const target = removal.current;
    removal.current = null;
    if (!target) return;
    if (focusControl(target.id, "remove")) return;
    focusNear(photos, target.index, "remove");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fotos</CardTitle>
        <CardDescription>
          Se achican solas antes de subir, así que podés usar las del celular.
          La descripción es opcional: la usan los buscadores y se muestra si la
          foto no carga.
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
                : quotaText(photos.length)}
            </p>
          </div>
        ) : (
          <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
            Para subir fotos falta configurar el almacenamiento (SUPABASE_URL /
            SUPABASE_SECRET_KEY).
          </p>
        )}

        {photos.length === 0 ? (
          // tabIndex -1: recibe el foco cuando se quita la ultima foto.
          <p
            id={EMPTY_MESSAGE_ID}
            tabIndex={-1}
            className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            No hay fotos en la tira, así que la web muestra las de siempre.
            Cuando subas la primera, pasa a mostrar solo las de acá: conviene
            subirlas todas de una vez, y que sean al menos{" "}
            {MIN_SUGGESTED_STRIP_PHOTOS}.
          </p>
        ) : (
          <ol
            className="grid gap-3"
            onFocus={(event) => {
              const target = event.target as HTMLElement;
              const photoId =
                target.closest<HTMLElement>("[data-photo-id]")?.dataset.photoId;
              const control = target.dataset.control as Control | undefined;
              focused.current =
                photoId && control ? { photoId, control } : null;
            }}
            onBlur={(event) => {
              // A otro lado de la pagina, a proposito: ya no hay que seguirla.
              const next = event.relatedTarget;
              if (next instanceof Node && !event.currentTarget.contains(next)) {
                focused.current = null;
              }
            }}
          >
            {photos.map((photo, index) => {
              const position = index + 1;
              const busy = moving && movingId === photo.id;
              const moveEarlier = `Mover la foto ${position} un lugar antes`;
              const moveLater = `Mover la foto ${position} un lugar después`;
              return (
                <li
                  key={photo.id}
                  data-photo-id={photo.id}
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
                    <AltForm
                      photoId={photo.id}
                      position={position}
                      saved={photo.alt}
                    />
                    <div className="flex flex-wrap items-center gap-1">
                      {/* "Mover" y no "subir": en esta pantalla "subir" es
                          subir una foto. */}
                      <Button
                        id={controlId(photo.id, "up")}
                        data-control="up"
                        variant="ghost"
                        size="icon"
                        aria-label={moveEarlier}
                        title={moveEarlier}
                        disabled={index === 0 || busy}
                        onClick={() => move(photo.id, index, "up")}
                      >
                        <ChevronUp className="size-4" />
                      </Button>
                      <Button
                        id={controlId(photo.id, "down")}
                        data-control="down"
                        variant="ghost"
                        size="icon"
                        aria-label={moveLater}
                        title={moveLater}
                        disabled={index === photos.length - 1 || busy}
                        onClick={() => move(photo.id, index, "down")}
                      >
                        <ChevronDown className="size-4" />
                      </Button>
                      <Button
                        id={controlId(photo.id, "remove")}
                        data-control="remove"
                        variant="ghost"
                        size="sm"
                        aria-label={`Quitar la foto ${position}`}
                        disabled={busy}
                        onClick={() => askRemove(photo.id, index)}
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
        <AlertDialogContent onCloseAutoFocus={focusAfterRemoval}>
          <AlertDialogHeader>
            <AlertDialogTitle>Quitar la foto {toRemove?.position}</AlertDialogTitle>
            <AlertDialogDescription>
              Sale de la tira de la web y se borra el archivo. Para volver a
              ponerla hay que subirla de nuevo.
              {toRemove?.last
                ? " Es la única: sin ninguna, la web vuelve a mostrar las de siempre."
                : null}
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
                confirmRemove();
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
  // La descripcion guardada que el campo ya refleja. Cuando cambia en el
  // servidor (este formulario la guardo, recortada, u otra pestaña la cambio)
  // el campo la toma aca, mientras se dibuja. No con un `key` que cambie con
  // ella: eso rearmaria el formulario y se llevaria el foco del teclado.
  const [shownSaved, setShownSaved] = useState(saved);
  if (saved !== shownSaved) {
    setShownSaved(saved);
    setValue(saved ?? "");
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = controlId(photoId, "alt");
  const unchanged = value.trim() === (saved ?? "");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || unchanged) return;
    // "Guardar" se deshabilita mientras guarda, y despues sigue deshabilitado
    // porque no queda nada nuevo: un boton deshabilitado pierde el foco. Si se
    // llego a el con el teclado, el foco vuelve al campo; con el mouse o el
    // dedo no, para no abrirle el teclado del celular a nadie.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const fromKeyboard = submitter?.matches(":focus-visible") ?? false;
    const formData = new FormData(event.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const result = await updateStripPhotoAltAction(photoId, formData);
      if (result.ok) toast.success(result.message);
      // La quitaron desde otro lado y la lista se esta refrescando sin ella:
      // un error dentro de la fila se iria con la fila.
      else if (result.error === STRIP_NOT_FOUND_ERROR) toast.error(result.error);
      else setError(result.error);
    } catch {
      setError(UNEXPECTED_ERROR);
    } finally {
      setSaving(false);
    }
    const active = document.activeElement;
    if (
      fromKeyboard &&
      (active === null || active === document.body || active === submitter)
    ) {
      inputRef.current?.focus();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-2">
      <Label htmlFor={inputId}>
        Descripción corta<span className="sr-only"> de la foto {position}</span>
      </Label>
      <div className="flex flex-wrap gap-2">
        <Input
          ref={inputRef}
          id={inputId}
          data-control="alt"
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
          id={controlId(photoId, "save")}
          data-control="save"
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
