"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
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
import type { CategoryRow } from "./queries";
import {
  createProductCategoryAction,
  createProductSubtypeAction,
  moverProductCategoryAction,
  renameProductCategoryAction,
  renameProductSubtypeAction,
  setProductCategoryActiveAction,
  setProductSubtypeActiveAction,
} from "./actions";

type RenameTarget = {
  id: string;
  name: string;
  nivel: "categoria" | "subtipo";
};

export function CatalogManager(props: { categories: CategoryRow[] }) {
  const { categories } = props;
  const [creando, setCreando] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [renombrar, setRenombrar] = useState<RenameTarget | null>(null);

  async function crearCategoria(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creando) return;
    setCreando(true);
    const form = event.currentTarget;
    const result = await createProductCategoryAction(new FormData(form));
    setCreando(false);
    if (result.ok) {
      toast.success(result.message);
      form.reset();
    } else toast.error(result.error);
  }

  async function mover(id: string, direccion: "arriba" | "abajo") {
    if (ocupado) return;
    setOcupado(id);
    const result = await moverProductCategoryAction(id, direccion);
    setOcupado(null);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  async function alternar(
    id: string,
    activo: boolean,
    nivel: "categoria" | "subtipo",
  ) {
    if (ocupado) return;
    setOcupado(id);
    const result =
      nivel === "categoria"
        ? await setProductCategoryActiveAction(id, !activo)
        : await setProductSubtypeActiveAction(id, !activo);
    setOcupado(null);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Categorías de producto</CardTitle>
        <CardDescription>
          Definen los filtros de la web: primero la categoría (mate, bombilla) y
          dentro de ella el subtipo (de calabaza, de metal). Las que ya tienen
          productos no se eliminan, se desactivan.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        {categories.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Todavía no hay categorías. Creá la primera abajo (por ejemplo
            &ldquo;Mate&rdquo;) y después agregale subtipos.
          </p>
        ) : null}

        {categories.map((categoria, indice) => (
          <div
            key={categoria.id}
            className="grid gap-1.5 rounded-md border p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={
                    categoria.isActive
                      ? "truncate font-medium"
                      : "truncate font-medium text-muted-foreground line-through"
                  }
                >
                  {categoria.name}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  /{categoria.slug}
                </span>
                {!categoria.isActive ? (
                  <Badge variant="secondary">Inactiva</Badge>
                ) : null}
                {categoria.productCount > 0 ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {categoria.productCount}{" "}
                    {categoria.productCount === 1 ? "producto" : "productos"}
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {/* El orden de los estantes en la tienda. Se mueve de a un
                    lugar en vez de escribir un numero: nadie piensa "Mates es
                    10", piensan "los mates van primero". */}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Subir ${categoria.name}`}
                  disabled={indice === 0 || ocupado === categoria.id}
                  onClick={() => void mover(categoria.id, "arriba")}
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Bajar ${categoria.name}`}
                  disabled={
                    indice === categories.length - 1 || ocupado === categoria.id
                  }
                  onClick={() => void mover(categoria.id, "abajo")}
                >
                  <ChevronDown className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setRenombrar({
                      id: categoria.id,
                      name: categoria.name,
                      nivel: "categoria",
                    })
                  }
                >
                  Renombrar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={ocupado === categoria.id}
                  onClick={() =>
                    void alternar(categoria.id, categoria.isActive, "categoria")
                  }
                >
                  {categoria.isActive ? "Desactivar" : "Reactivar"}
                </Button>
              </span>
            </div>

            <div className="grid gap-1 border-l pl-3">
              {categoria.subtypes.map((subtipo) => (
                <div
                  key={subtipo.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={
                        subtipo.isActive
                          ? "truncate"
                          : "truncate text-muted-foreground line-through"
                      }
                    >
                      {subtipo.name}
                    </span>
                    {!subtipo.isActive ? (
                      <Badge variant="secondary">Inactivo</Badge>
                    ) : null}
                    {subtipo.productCount > 0 ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {subtipo.productCount}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        setRenombrar({
                          id: subtipo.id,
                          name: subtipo.name,
                          nivel: "subtipo",
                        })
                      }
                    >
                      Renombrar
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={ocupado === subtipo.id}
                      onClick={() =>
                        void alternar(subtipo.id, subtipo.isActive, "subtipo")
                      }
                    >
                      {subtipo.isActive ? "Desactivar" : "Reactivar"}
                    </Button>
                  </span>
                </div>
              ))}

              <SubtypeForm categoryId={categoria.id} />
            </div>
          </div>
        ))}

        <form
          onSubmit={crearCategoria}
          className="flex flex-wrap items-end gap-2 border-t pt-4"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="nueva-categoria">Nueva categoría</Label>
            <Input
              id="nueva-categoria"
              name="name"
              maxLength={60}
              required
              placeholder="Ej: Bombilla"
              className="w-56"
            />
          </div>
          <Button type="submit" size="sm" disabled={creando}>
            {creando ? "Creando…" : "Crear categoría"}
          </Button>
        </form>
      </CardContent>

      <Dialog
        open={renombrar !== null}
        onOpenChange={(open) => !open && setRenombrar(null)}
      >
        <DialogContent className="sm:max-w-sm">
          {renombrar !== null ? (
            <RenameForm
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

function SubtypeForm(props: { categoryId: string }) {
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enviando) return;
    setEnviando(true);
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("categoryId", props.categoryId);
    const result = await createProductSubtypeAction(formData);
    setEnviando(false);
    if (result.ok) {
      toast.success(result.message);
      form.reset();
    } else toast.error(result.error);
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 pt-1">
      <Input
        name="name"
        maxLength={60}
        required
        placeholder="Agregar subtipo (ej: De metal)"
        className="h-7 w-56 text-sm"
        aria-label="Nombre del subtipo"
      />
      <Button type="submit" size="xs" variant="outline" disabled={enviando}>
        {enviando ? "…" : "Agregar"}
      </Button>
    </form>
  );
}

function RenameForm(props: { target: RenameTarget; onClose: () => void }) {
  const { target, onClose } = props;
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setError(null);
    const formData = new FormData(event.currentTarget);
    const result =
      target.nivel === "categoria"
        ? await renameProductCategoryAction(target.id, formData)
        : await renameProductSubtypeAction(target.id, formData);
    setEnviando(false);
    if (result.ok) {
      toast.success(result.message);
      onClose();
    } else setError(result.error);
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Renombrar {target.nivel === "categoria" ? "categoría" : "subtipo"}
        </DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="renombrar-nombre">Nombre</Label>
          <Input
            id="renombrar-nombre"
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
