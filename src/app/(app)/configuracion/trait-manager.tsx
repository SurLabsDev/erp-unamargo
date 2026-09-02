"use client";

import { useState } from "react";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TraitRow } from "./queries";
import {
  createProductTraitAction,
  renameProductTraitAction,
  setProductTraitActiveAction,
  updateProductTraitLabelAction,
} from "./actions";

/**
 * El tercer eje de clasificacion, y como se llama.
 *
 * `settings.product_trait_label` es la unica columna de configuracion que
 * guarda el NOMBRE de un campo en vez de un dato, y editarla es media funcion
 * de esta pantalla: el eje existe en todas las instancias, pero que sea el
 * material, el talle o el sabor lo decide cada cliente. Por eso la etiqueta se
 * edita arriba de sus valores y no en otra tarjeta: separadas, nadie entiende
 * que una titula a la otra.
 */
export function TraitManager(props: { etiqueta: string; traits: TraitRow[] }) {
  const { etiqueta, traits } = props;
  const [guardandoEtiqueta, setGuardandoEtiqueta] = useState(false);
  const [creando, setCreando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [renombrar, setRenombrar] = useState<TraitRow | null>(null);

  async function guardarEtiqueta(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guardandoEtiqueta) return;
    setGuardandoEtiqueta(true);
    const result = await updateProductTraitLabelAction(
      new FormData(event.currentTarget),
    );
    setGuardandoEtiqueta(false);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  async function crearValor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creando) return;
    setCreando(true);
    const form = event.currentTarget;
    const result = await createProductTraitAction(new FormData(form));
    setCreando(false);
    if (result.ok) {
      toast.success(result.message);
      form.reset();
    } else toast.error(result.error);
  }

  async function alternar(id: string, activo: boolean) {
    if (ocupado) return;
    setOcupado(id);
    const result = await setProductTraitActiveAction(id, !activo);
    setOcupado(null);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{etiqueta}</CardTitle>
        {/* La copy describe lo que ya funciona y nada mas. Antes prometia "la
            web lo usa como filtro" en presente y era falso: el valor sale en
            /api/public/v1/stock (`trait`, y `trait_label` al lado de `items`),
            pero el sitio del cliente todavia no lo consume, ni siquiera lo
            declara en el tipo `Producto` de `web-unamargo/src/lib/catalog.ts`.
            El cliente podia clasificar el catalogo entero y no ver ningun
            filtro nuevo en su sitio.

            Tampoco se promete nada sobre la lista de Stock: adentro del ERP el
            valor se elige y se ve en la ficha del producto, y se cuenta en esta
            tarjeta; `stock-catalog.tsx` no muestra ni filtra por el eje. */}
        <CardDescription>
          Una clasificación más, aparte de la categoría y el subtipo: cada
          producto lleva un valor solo, y se elige en la ficha del producto. Por
          ahora vive puertas adentro, para tener el catálogo clasificado y ver
          acá cuántos productos hay en cada valor. El dato ya sale en la API
          pública, así que el día que la web lo use como filtro no vas a tener
          que volver a cargar nada. Ningún valor se elimina: se desactiva, y los
          productos que ya lo tenían lo conservan.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        <form
          onSubmit={guardarEtiqueta}
          className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="etiqueta-eje">
              Cómo se llama esta clasificación
            </Label>
            <Input
              id="etiqueta-eje"
              name="label"
              defaultValue={etiqueta}
              maxLength={30}
              required
              className="w-56"
            />
          </div>
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={guardandoEtiqueta}
          >
            {guardandoEtiqueta ? "Guardando…" : "Guardar nombre"}
          </Button>
          {/* Misma correccion que arriba, y los tres lugares estan medidos: el
              titulo de esta tarjeta, el `<Label>` del selector en
              `product-content.tsx` y el campo `trait_label` de la API. Titular
              el filtro de la web es para lo que esta el dato, no algo que ya
              este pasando.

              El ejemplo no nombra el rubro del cliente: el valor por defecto es
              "Característica" y la lista de ejemplos va suelta, sin dar por
              hecho cual esta cargado. */}
          <p className="w-full text-xs text-muted-foreground">
            Es el título que ves acá y en la ficha de cada producto, y el que
            viaja en la API para titular el filtro cuando la web lo use. Poné el
            que se entienda en tu rubro, por ejemplo Material, Talle o Sabor.
          </p>
        </form>

        {traits.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Todavía no hay valores cargados. Agregá el primero abajo y después
            vas a poder elegirlo en la ficha de cada producto.
          </p>
        ) : (
          <div className="grid gap-1">
            {traits.map((valor) => (
              <div
                key={valor.id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={
                      valor.isActive
                        ? "truncate font-medium"
                        : "truncate font-medium text-muted-foreground line-through"
                    }
                  >
                    {valor.name}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    /{valor.slug}
                  </span>
                  {!valor.isActive ? (
                    <Badge variant="secondary">Inactivo</Badge>
                  ) : null}
                  {valor.productCount > 0 ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {valor.productCount}{" "}
                      {valor.productCount === 1 ? "producto" : "productos"}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setRenombrar(valor)}
                  >
                    Renombrar
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={ocupado === valor.id}
                    onClick={() => void alternar(valor.id, valor.isActive)}
                  >
                    {valor.isActive ? "Desactivar" : "Reactivar"}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}

        <form
          onSubmit={crearValor}
          className="flex flex-wrap items-end gap-2 border-t pt-4"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="nuevo-valor">Nuevo valor</Label>
            <Input
              id="nuevo-valor"
              name="name"
              maxLength={60}
              required
              placeholder={`Agregar a ${etiqueta.toLowerCase()}`}
              className="w-56"
            />
          </div>
          <Button type="submit" size="sm" disabled={creando}>
            {creando ? "Creando…" : "Crear valor"}
          </Button>
        </form>
      </CardContent>

      <Dialog
        open={renombrar !== null}
        onOpenChange={(open) => !open && setRenombrar(null)}
      >
        <DialogContent className="sm:max-w-sm">
          {renombrar !== null ? (
            <RenameTraitForm
              key={renombrar.id}
              target={renombrar}
              onClose={() => setRenombrar(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function RenameTraitForm(props: { target: TraitRow; onClose: () => void }) {
  const { target, onClose } = props;
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setError(null);
    const result = await renameProductTraitAction(
      target.id,
      new FormData(event.currentTarget),
    );
    setEnviando(false);
    if (result.ok) {
      toast.success(result.message);
      onClose();
    } else setError(result.error);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Renombrar valor</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="renombrar-valor">Nombre</Label>
          <Input
            id="renombrar-valor"
            name="name"
            defaultValue={target.name}
            maxLength={60}
            required
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Cambia solo la etiqueta. La dirección web se mantiene para no romper
            los enlaces ya publicados.
          </p>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={enviando}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={enviando}>
            {enviando ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
