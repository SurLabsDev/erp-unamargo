"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OpcionClasificacion } from "./queries";

export const SIN_CLASIFICAR = "sin";

/**
 * Categoria + subtipo. El subtipo se filtra por la categoria elegida: es la
 * jerarquia que despues usa la web para filtrar (primero mate/bombilla, dentro
 * de eso de calabaza/de metal).
 *
 * Cambiar de categoria RESETEA el subtipo. Si no, quedaria seleccionado uno que
 * no pertenece, y la foranea compuesta de la base lo rechazaria con un error
 * confuso en vez de evitarlo de entrada.
 */
export function ClassificationSelects(props: {
  opciones: OpcionClasificacion[];
  categoriaInicial?: string | null;
  subtipoInicial?: string | null;
  idPrefijo: string;
}) {
  const { opciones, idPrefijo } = props;
  const [categoria, setCategoria] = useState(
    props.categoriaInicial ?? SIN_CLASIFICAR,
  );
  const [subtipo, setSubtipo] = useState(
    props.subtipoInicial ?? SIN_CLASIFICAR,
  );

  const subtipos = opciones.find((o) => o.id === categoria)?.subtypes ?? [];

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefijo}-categoria`}>Categoría</Label>
        <Select
          value={categoria}
          onValueChange={(value) => {
            setCategoria(value);
            setSubtipo(SIN_CLASIFICAR);
          }}
        >
          <SelectTrigger id={`${idPrefijo}-categoria`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SIN_CLASIFICAR}>Sin categoría</SelectItem>
            {opciones.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input type="hidden" name="categoryId" value={categoria} />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${idPrefijo}-subtipo`}>Subtipo</Label>
        <Select
          value={subtipo}
          onValueChange={setSubtipo}
          disabled={categoria === SIN_CLASIFICAR || subtipos.length === 0}
        >
          <SelectTrigger id={`${idPrefijo}-subtipo`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SIN_CLASIFICAR}>Sin subtipo</SelectItem>
            {subtipos.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input type="hidden" name="subtypeId" value={subtipo} />
        {categoria === SIN_CLASIFICAR ? (
          <p className="text-xs text-muted-foreground">
            Elegí primero la categoría.
          </p>
        ) : null}
      </div>
    </div>
  );
}
