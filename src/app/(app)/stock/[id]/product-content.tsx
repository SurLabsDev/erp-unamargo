"use client";

import { useState } from "react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { updateProductContentAction } from "../actions";
import { ClassificationSelects } from "../classification-selects";
import type { OpcionClasificacion } from "../queries";

export function ProductContent(props: {
  productId: string;
  price: string | null;
  description: string | null;
  categoryId: string | null;
  subtypeId: string | null;
  slug: string | null;
  currencyCode: string;
  opciones: OpcionClasificacion[];
  puedeEditar: boolean;
}) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guardando) return;
    setGuardando(true);
    setError(null);
    const result = await updateProductContentAction(
      props.productId,
      new FormData(event.currentTarget),
    );
    setGuardando(false);
    if (result.ok) toast.success(result.message);
    else setError(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ficha para la web</CardTitle>
        <CardDescription>
          Precio, descripción y clasificación. No afecta el stock ni el módulo
          Dinero: el precio se publica, no registra ventas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <ClassificationSelects
            opciones={props.opciones}
            categoriaInicial={props.categoryId}
            subtipoInicial={props.subtypeId}
            idPrefijo="ficha"
          />

          <div className="grid gap-2 sm:max-w-xs">
            <Label htmlFor="ficha-precio">Precio ({props.currencyCode})</Label>
            <Input
              id="ficha-precio"
              name="price"
              inputMode="decimal"
              defaultValue={props.price ?? ""}
              placeholder="0,00"
              disabled={!props.puedeEditar}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ficha-descripcion">Descripción</Label>
            <Textarea
              id="ficha-descripcion"
              name="description"
              rows={4}
              maxLength={2000}
              defaultValue={props.description ?? ""}
              placeholder="Lo que va a leer alguien en la web antes de escribir por WhatsApp."
              disabled={!props.puedeEditar}
            />
          </div>

          {props.slug ? (
            <p className="text-xs text-muted-foreground">
              Dirección en la web:{" "}
              <span className="font-mono">/producto/{props.slug}</span>. No
              cambia al renombrar el producto, para no romper los enlaces ya
              compartidos.
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {props.puedeEditar ? (
            <div>
              <Button type="submit" size="sm" disabled={guardando}>
                {guardando ? "Guardando…" : "Guardar ficha"}
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
