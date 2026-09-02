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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { updateProductContentAction } from "../actions";
import {
  ClassificationSelects,
  SIN_CLASIFICAR,
} from "../classification-selects";
import type { OpcionClasificacion, OpcionEje } from "../queries";
import type { AppliedDiscount } from "@/lib/domain/discounts";
import { formatMoney } from "@/lib/format";

export function ProductContent(props: {
  productId: string;
  price: string | null;
  description: string | null;
  categoryId: string | null;
  subtypeId: string | null;
  traitId: string | null;
  slug: string | null;
  currencyCode: string;
  opciones: OpcionClasificacion[];
  /** Como se llama el tercer eje en esta instancia (Material, Talle, Sabor). */
  etiquetaEje: string;
  /** Todos los valores del eje, activos y desactivados. El filtrado es de esta
   *  pantalla, no de la consulta: ver `valoresVisibles`. */
  valoresEje: OpcionEje[];
  puedeEditar: boolean;
  discount?: AppliedDiscount | null;
}) {
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El Select de Radix no es un control de formulario: el valor viaja en un
  // input oculto, igual que en ClassificationSelects.
  const [valorEje, setValorEje] = useState(props.traitId ?? SIN_CLASIFICAR);

  // Se ofrecen los activos MAS el que el producto ya tiene, aunque este
  // desactivado. Si se filtrara solo por activos, ese valor no matchearia
  // ninguna opcion y el Select quedaria en blanco: el admin veria un campo
  // vacio, indistinguible de "sin clasificar", y al guardar cualquier otra
  // cosa lo pisaria sin enterarse de que habia algo.
  // El anclaje es `props.traitId` (lo guardado) y no `valorEje` (lo elegido en
  // pantalla): asi la opcion no desaparece al cambiarla y se puede volver
  // atras antes de guardar.
  const valoresVisibles = props.valoresEje.filter(
    (valor) => valor.isActive || valor.id === props.traitId,
  );
  // El aviso mira los ACTIVOS, no la lista visible: con un solo valor
  // desactivado a la vista tampoco hay nada para elegir, y ahi es cuando hace
  // falta decir donde se arregla.
  const hayValoresActivos = props.valoresEje.some((valor) => valor.isActive);

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

          {/* Un solo campo, asi que va suelto y acotado como el precio. La
              grilla de dos columnas es de ClassificationSelects, que tiene dos
              hijos; con uno solo dejaba media fila vacia al costado. */}
          <div className="grid gap-2 sm:max-w-xs">
            <Label htmlFor="ficha-eje">{props.etiquetaEje}</Label>
            <Select
              value={valorEje}
              onValueChange={setValorEje}
              disabled={!props.puedeEditar}
            >
              <SelectTrigger id="ficha-eje">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_CLASIFICAR}>Sin definir</SelectItem>
                {valoresVisibles.map((valor) => (
                  <SelectItem key={valor.id} value={valor.id}>
                    {valor.isActive
                      ? valor.name
                      : `${valor.name} (desactivado)`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="traitId" value={valorEje} />
            {!hayValoresActivos ? (
              <p className="text-xs text-muted-foreground">
                Todavía no hay valores activos. Se cargan o se reactivan en
                Configuración.
              </p>
            ) : null}
          </div>

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
            {props.discount ? (
              <p className="text-sm text-muted-foreground">
                Precio con descuento vigente:{" "}
                <span className="font-medium text-foreground">
                  {formatMoney(
                    props.discount.priceFinal,
                    props.currencyCode,
                  )}
                </span>{" "}
                por la campaña &ldquo;{props.discount.campaignName}&rdquo; (
                {props.discount.percentage}%).
              </p>
            ) : null}
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
