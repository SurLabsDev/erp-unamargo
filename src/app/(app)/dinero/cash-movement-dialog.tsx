"use client";

import { Plus } from "lucide-react";
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
import { createCashMovementAction, registerSaleAction } from "./actions";

type CategoryOption = { id: string; name: string; kind: "income" | "expense" };
export type ProductoVendible = {
  id: string;
  sku: string;
  name: string;
  price: string | null;
};

export function NewCashMovementButton(props: {
  categories: CategoryOption[];
  productos: ProductoVendible[];
  todayISO: string;
  minDateISO: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        Nuevo movimiento
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          {open ? (
            <CashMovementForm {...props} onClose={() => setOpen(false)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CashMovementForm(props: {
  categories: CategoryOption[];
  productos: ProductoVendible[];
  todayISO: string;
  minDateISO: string;
  onClose: () => void;
}) {
  const { categories, productos, todayISO, minDateISO, onClose } = props;
  // Un paso a la vez. El formulario de antes pedia cinco decisiones juntas
  // -tipo, fecha, categoria, concepto y monto- y la mas facil de todas, si es
  // plata que entra o que sale, estaba escondida en un desplegable.
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [kind, setKind] = useState<"income" | "expense">("income");
  const [categoryId, setCategoryId] = useState<string>("");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [busqueda, setBusqueda] = useState("");
  // Si hay producto elegido, esto deja de ser "anotar plata" y pasa a ser una
  // VENTA: descuenta stock ademas de anotar el ingreso.
  const [producto, setProducto] = useState<ProductoVendible | null>(null);
  const [cantidad, setCantidad] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kindCategories = categories.filter((c) => c.kind === kind);
  const categoriaElegida = categories.find((c) => c.id === categoryId);

  const vendibles = productos.filter((p) => {
    const t = busqueda.trim().toLowerCase();
    if (t === "") return true;
    return (
      p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)
    );
  });

  function elegirProducto(p: ProductoVendible) {
    setProducto(p);
    setCantidad("1");
    setPaso(3);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const formData = new FormData(event.currentTarget);
    formData.set("kind", kind);
    formData.set("categoryId", categoryId);
    const result = producto
      ? await (async () => {
          formData.set("productId", producto.id);
          formData.set("quantity", cantidad);
          return registerSaleAction(formData);
        })()
      : await createCashMovementAction(formData);
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
        <DialogTitle>Nuevo movimiento de dinero</DialogTitle>
        <DialogDescription>
          Control interno. No reemplaza la contabilidad formal.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="grid gap-4">
        {/* PASO 1: lo mas facil de contestar, y lo que decide todo lo demas. */}
        {paso === 1 ? (
          <div className="grid gap-3">
            <p className="text-sm font-medium">¿Qué vas a registrar?</p>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["income", "Ingreso", "Plata que entra"],
                  ["expense", "Egreso", "Plata que sale"],
                ] as const
              ).map(([valor, titulo, ayuda]) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => {
                    setKind(valor);
                    setCategoryId("");
                    setPaso(2);
                  }}
                  className="grid gap-1 rounded-md border p-4 text-left transition-colors hover:border-primary hover:bg-accent"
                >
                  <span className="font-medium">{titulo}</span>
                  <span className="text-xs text-muted-foreground">{ayuda}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* PASO 2: las categorias como botones. Un desplegable de seis opciones
            esconde justo lo que hay que comparar para elegir. */}
        {paso === 2 ? (
          <div className="grid gap-3">
            <p className="text-sm font-medium">
              {kind === "income" ? "¿De dónde entra?" : "¿En qué se gastó?"}
            </p>
            {kindCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay categorías de {kind === "income" ? "ingreso" : "egreso"}.
                Se crean en Configuración.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {kindCategories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCategoryId(c.id);
                      setPaso(3);
                    }}
                    className="rounded-md border px-4 py-3 text-left text-sm transition-colors hover:border-primary hover:bg-accent"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* PASO 3: el detalle. Para un ingreso se ofrece elegir el producto, que
            completa concepto y monto solo. */}
        {paso === 3 ? (
          <div className="grid gap-4">
            {kind === "income" && productos.length > 0 ? (
              <div className="grid gap-2">
                <Label htmlFor="buscar-producto">
                  ¿Qué producto vendiste?{" "}
                  <span className="font-normal text-muted-foreground">
                    (opcional)
                  </span>
                </Label>
                <Input
                  id="buscar-producto"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscá por nombre o SKU…"
                />
                <div className="max-h-44 overflow-y-auto rounded-md border">
                  {vendibles.slice(0, 40).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => elegirProducto(p)}
                      className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 transition-colors hover:bg-accent"
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="cifras shrink-0 text-muted-foreground">
                        {p.price === null ? "sin precio" : p.price}
                      </span>
                    </button>
                  ))}
                  {vendibles.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-muted-foreground">
                      Ningún producto coincide.
                    </p>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Elegir un producto lo registra como venta: descuenta el stock
                  y anota la plata de una sola vez.
                </p>
              </div>
            ) : null}

            {producto ? (
              <div className="grid gap-3 rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {producto.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Se descuenta del stock al registrar.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setProducto(null)}
                  >
                    Quitar
                  </Button>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="venta-cantidad">Cantidad</Label>
                  <Input
                    id="venta-cantidad"
                    inputMode="numeric"
                    value={cantidad}
                    onChange={(e) => setCantidad(e.target.value)}
                    required
                  />
                </div>
                {/* El precio NO se escribe a mano: lo pone el sistema con el
                    descuento vigente. Si se pudiera escribir, la campana
                    quedaria registrada con un precio que nadie cobro. */}
                <p className="text-xs text-muted-foreground">
                  El precio sale del catálogo, con el descuento que esté
                  vigente.
                </p>
              </div>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="cash-concept">Concepto</Label>
                <Input
                  id="cash-concept"
                  name="concept"
                  maxLength={200}
                  required
                  value={concepto}
                  onChange={(e) => setConcepto(e.target.value)}
                  placeholder="p. ej., Ventas de la semana"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {producto ? null : (
                <div className="grid gap-2">
                  <Label htmlFor="cash-amount">Monto</Label>
                  <Input
                    id="cash-amount"
                    name="amount"
                    inputMode="decimal"
                    placeholder="0,00"
                    required
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="cash-date">Fecha</Label>
                <Input
                  id="cash-date"
                  name="date"
                  type="date"
                  defaultValue={todayISO}
                  min={minDateISO}
                  max={todayISO}
                  required
                />
              </div>
            </div>
          </div>
        ) : null}

        {/* Rastro de lo ya elegido: sin esto, tres pasos adentro no se sabe que
            se contesto antes y hay que cancelar para verificar. */}
        {paso > 1 ? (
          <p className="text-xs text-muted-foreground">
            {kind === "income" ? "Ingreso" : "Egreso"}
            {categoriaElegida ? ` · ${categoriaElegida.name}` : ""}
          </p>
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
            onClick={() => (paso === 1 ? onClose() : setPaso(paso === 3 ? 2 : 1))}
            disabled={submitting}
          >
            {paso === 1 ? "Cancelar" : "Atrás"}
          </Button>
          {paso === 3 ? (
            <Button type="submit" disabled={submitting || categoryId === ""}>
              {submitting
                ? "Registrando…"
                : producto
                  ? "Registrar venta"
                  : "Registrar"}
            </Button>
          ) : null}
        </DialogFooter>
      </form>
    </>
  );
}
