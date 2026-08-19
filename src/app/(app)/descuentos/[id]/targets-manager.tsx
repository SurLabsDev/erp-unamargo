"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { OpcionClasificacion } from "@/app/(app)/stock/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { addTargetAction, removeTargetAction } from "../actions";
import type { TargetRow } from "../queries";

type ProductOption = { id: string; sku: string; name: string };

type Level = "product" | "subtype" | "category";

const LEVEL_LABELS: Record<Level, string> = {
  product: "Producto",
  subtype: "Subtipo",
  category: "Categoría",
};

// Product first, then subtype, then category: same precedence order as the
// notice above the table, so the list reads top-to-bottom as "most specific
// first" instead of creation order.
const LEVEL_ORDER: Level[] = ["product", "subtype", "category"];

export function TargetsManager(props: {
  campaignId: string;
  targets: TargetRow[];
  opciones: OpcionClasificacion[];
  productos: ProductOption[];
}) {
  const { campaignId, targets, opciones, productos } = props;

  const [categoryId, setCategoryId] = useState("");
  const [subtypeId, setSubtypeId] = useState("");
  const [productId, setProductId] = useState("");
  const [adding, setAdding] = useState<Level | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Same subtype name can exist under two categories (the schema allows it on
  // purpose), so every option is labelled "Categoría — Subtipo", not just the
  // bare subtype name.
  const subtypeOptions = opciones.flatMap((categoria) =>
    categoria.subtypes.map((subtipo) => ({
      id: subtipo.id,
      label: `${categoria.name} — ${subtipo.name}`,
    })),
  );

  async function handleAdd(level: Level, value: string) {
    if (!value || adding !== null) return;
    setAdding(level);
    const formData = new FormData();
    formData.set("campaignId", campaignId);
    formData.set(`${level}Id`, value);
    const result = await addTargetAction(formData);
    setAdding(null);
    if (result.ok) {
      toast.success(result.message);
      if (level === "category") setCategoryId("");
      if (level === "subtype") setSubtypeId("");
      if (level === "product") setProductId("");
    } else {
      toast.error(result.error);
    }
  }

  async function handleRemove(target: TargetRow) {
    if (removingId !== null) return;
    setRemovingId(target.id);
    const result = await removeTargetAction(target.id);
    setRemovingId(null);
    if (result.ok) toast.success(result.message);
    else toast.error(result.error);
  }

  const sortedTargets = [...targets].sort(
    (a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Objetivos</CardTitle>
        <CardDescription>
          Si un producto queda alcanzado por más de una campaña, gana la
          regla más puntual: producto, después subtipo, después categoría.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label>Categoría</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Elegí una categoría" />
              </SelectTrigger>
              <SelectContent>
                {opciones.map((categoria) => (
                  <SelectItem key={categoria.id} value={categoria.id}>
                    {categoria.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!categoryId || adding !== null}
              onClick={() => void handleAdd("category", categoryId)}
            >
              {adding === "category" ? "Agregando…" : "Agregar categoría"}
            </Button>
          </div>

          <div className="grid gap-2">
            <Label>Subtipo</Label>
            <Select value={subtypeId} onValueChange={setSubtypeId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Elegí un subtipo" />
              </SelectTrigger>
              <SelectContent>
                {subtypeOptions.map((subtipo) => (
                  <SelectItem key={subtipo.id} value={subtipo.id}>
                    {subtipo.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!subtypeId || adding !== null}
              onClick={() => void handleAdd("subtype", subtypeId)}
            >
              {adding === "subtype" ? "Agregando…" : "Agregar subtipo"}
            </Button>
          </div>

          <div className="grid gap-2">
            <Label>Producto</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Elegí un producto" />
              </SelectTrigger>
              <SelectContent>
                {productos.map((producto) => (
                  <SelectItem key={producto.id} value={producto.id}>
                    {producto.sku} — {producto.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!productId || adding !== null}
              onClick={() => void handleAdd("product", productId)}
            >
              {adding === "product" ? "Agregando…" : "Agregar producto"}
            </Button>
          </div>
        </div>

        {sortedTargets.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Esta campaña todavía no alcanza a ningún producto, subtipo ni
            categoría.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nivel</TableHead>
                  <TableHead>Alcanza a</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTargets.map((target) => (
                  <TableRow key={target.id}>
                    <TableCell>
                      <Badge variant="outline">
                        {LEVEL_LABELS[target.level]}
                      </Badge>
                    </TableCell>
                    <TableCell>{target.label}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={removingId === target.id}
                        onClick={() => void handleRemove(target)}
                      >
                        Quitar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
