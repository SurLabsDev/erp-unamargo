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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatInteger } from "@/lib/format";
import { registerMovementAction } from "./actions";

type MovementType = "entrada" | "salida" | "ajuste";

type ProductRef = {
  id: string;
  sku: string;
  name: string;
  currentStock: number;
};

export function MovementFormDialog(props: {
  product: ProductRef | null;
  onClose: () => void;
}) {
  const { product, onClose } = props;

  return (
    <Dialog open={product !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {product !== null ? (
          // Keyed by product so type/error/submitting reset per target.
          <MovementForm key={product.id} product={product} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MovementForm(props: { product: ProductRef; onClose: () => void }) {
  const { product, onClose } = props;
  const [type, setType] = useState<MovementType>("entrada");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const formData = new FormData(event.currentTarget);
    formData.set("productId", product.id);
    formData.set("type", type);
    const result = await registerMovementAction(formData);
    setSubmitting(false);
    if (result.ok) {
      toast.success(result.message);
      onClose();
    } else {
      setError(result.error);
    }
  }

  const isAdjustment = type === "ajuste";

  return (
    <>
      <DialogHeader>
        <DialogTitle>Registrar movimiento</DialogTitle>
        <DialogDescription>
          <span className="font-mono text-xs">{product.sku}</span> —{" "}
          {product.name} · Stock actual:{" "}
          <span className="tabular-nums">
            {formatInteger(product.currentStock)}
          </span>
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <Label>Tipo</Label>
          <Select
            value={type}
            onValueChange={(value) => setType(value as MovementType)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="entrada">Entrada (suma stock)</SelectItem>
              <SelectItem value="salida">Salida (resta stock)</SelectItem>
              <SelectItem value="ajuste">
                Ajuste (fija el stock contado)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isAdjustment ? (
          <div className="grid gap-2">
            <Label htmlFor="movement-counted">Stock contado</Label>
            <Input
              key="counted"
              id="movement-counted"
              name="countedStock"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              required
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Ingresá el stock físico contado; el sistema calcula la diferencia.
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="movement-quantity">Cantidad</Label>
            <Input
              key="quantity"
              id="movement-quantity"
              name="quantity"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              required
              autoFocus
            />
          </div>
        )}

        <div className="grid gap-2">
          <Label htmlFor="movement-note">
            Nota {isAdjustment ? "(obligatoria)" : "(opcional)"}
          </Label>
          <Textarea
            id="movement-note"
            name="note"
            rows={2}
            maxLength={500}
            required={isAdjustment}
            placeholder={
              isAdjustment ? "Motivo del ajuste (p. ej., recuento físico)" : ""
            }
          />
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
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Registrando…" : "Registrar"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
