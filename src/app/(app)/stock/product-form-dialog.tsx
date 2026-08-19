"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClassificationSelects } from "./classification-selects";
import { createProductAction, updateProductAction } from "./actions";
import type { CatalogRow, OpcionClasificacion } from "./queries";

type State = { mode: "create" } | { mode: "edit"; product: CatalogRow } | null;

export function ProductFormDialog(props: {
  state: State;
  onClose: () => void;
  opciones?: OpcionClasificacion[];
}) {
  const { state, onClose, opciones = [] } = props;
  // Keyed by target so transient state (error/submitting) resets per product.
  const formKey =
    state === null
      ? "closed"
      : state.mode === "edit"
        ? state.product.id
        : "create";

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {state !== null ? (
          <ProductForm
            key={formKey}
            state={state}
            onClose={onClose}
            opciones={opciones}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ProductForm(props: {
  state: NonNullable<State>;
  onClose: () => void;
  opciones?: OpcionClasificacion[];
}) {
  const { state, onClose, opciones = [] } = props;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = state.mode === "edit";
  const product = state.mode === "edit" ? state.product : null;
  const skuLocked = Boolean(product?.hasMovements);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const formData = new FormData(event.currentTarget);
    const result = product
      ? await updateProductAction(product.id, formData)
      : await createProductAction(formData);
    setSubmitting(false);
    if (result.ok) {
      toast.success(result.message);
      onClose();
    } else {
      setError(result.error);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {isEdit ? "Editar producto" : "Nuevo producto"}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Cada variante cuenta como un SKU."
            : "Cada variante cuenta como un SKU. El stock inicial queda registrado en el historial."}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="product-sku">SKU</Label>
          <Input
            id="product-sku"
            name="sku"
            defaultValue={product?.sku ?? ""}
            disabled={skuLocked}
            placeholder="MATE-IMP-CUE"
            className="font-mono uppercase"
            maxLength={40}
            required={!skuLocked}
            autoFocus={!isEdit}
          />
          {skuLocked ? (
            <p className="text-xs text-muted-foreground">
              El SKU no se puede modificar porque el producto ya tiene
              movimientos.
            </p>
          ) : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="product-name">Nombre</Label>
          <Input
            id="product-name"
            name="name"
            defaultValue={product?.name ?? ""}
            maxLength={120}
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="product-min">Stock mínimo</Label>
            <Input
              id="product-min"
              name="minStock"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              defaultValue={product?.minStock ?? 0}
              required
            />
            <p className="text-xs text-muted-foreground">0 = sin control</p>
          </div>
          {!isEdit ? (
            <div className="grid gap-2">
              <Label htmlFor="product-initial">Stock inicial</Label>
              <Input
                id="product-initial"
                name="initialStock"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                defaultValue={0}
              />
            </div>
          ) : null}
        </div>
        {/* La clasificacion se elige al crear. Para cambiarla despues esta la
            ficha del producto, que ademas tiene precio y descripcion: dos
            lugares que editan lo mismo se desincronizan solos. */}
        {!isEdit ? (
          <ClassificationSelects opciones={opciones} idPrefijo="nuevo" />
        ) : null}
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
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Guardando…" : isEdit ? "Guardar" : "Crear"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
