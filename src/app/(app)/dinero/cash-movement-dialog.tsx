"use client";

import { Plus, Printer } from "lucide-react";
import { useRef, useState } from "react";
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
  createCashMovementAction,
  registerSaleAction,
  registrarCompraAction,
  type Boleta as DatosBoleta,
} from "./actions";
import { imprimirTicket, VistaTicket } from "./ticket";

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
  moneda: string;
  empresa: string;
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
  moneda: string;
  empresa: string;
  onClose: () => void;
}) {
  const { categories, productos, todayISO, minDateISO, moneda, empresa, onClose } =
    props;
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
  /** Las lineas de la operacion. Una venta comun es un mate MAS una bombilla,
   *  y una compra al proveedor son diez articulos de la misma factura. */
  const [lineas, setLineas] = useState<
    { id: string; nombre: string; cantidad: string; precio: string }[]
  >([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Cuando hay boleta, la venta YA se guardo: el dialogo deja de ser un
   *  formulario y pasa a ser el comprobante. */
  const [boleta, setBoleta] = useState<DatosBoleta | null>(null);
  /** El iframe del ticket: imprimir es imprimir ESE documento, no la pagina. */
  const ticketRef = useRef<HTMLIFrameElement>(null);

  const kindCategories = categories.filter((c) => c.kind === kind);
  const categoriaElegida = categories.find((c) => c.id === categoryId);

  const vendibles = productos.filter((p) => {
    const t = busqueda.trim().toLowerCase();
    if (t === "") return true;
    return (
      p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)
    );
  });

  /** Con productos: la categoria mueve stock ademas de plata. Los ingresos que
   *  no son ventas -una devolucion, vender una estanteria vieja- y los egresos
   *  que no son mercaderia -alquiler, envios- no llevan productos. */
  const conProductos =
    categoriaElegida !== undefined &&
    /venta|mercader/i.test(categoriaElegida.name);

  function agregarProducto(p: ProductoVendible) {
    setLineas((ls) =>
      ls.some((l) => l.id === p.id)
        ? ls.map((l) =>
            l.id === p.id
              ? { ...l, cantidad: String(Number(l.cantidad || "0") + 1) }
              : l,
          )
        : [
            ...ls,
            {
              id: p.id,
              nombre: p.name,
              cantidad: "1",
              // El precio arranca en el del catalogo y se puede editar: un
              // "precio amigo" es una venta real y se registra por lo que se
              // cobro. En una compra arranca vacio, porque lo que se paga al
              // proveedor no tiene por que parecerse al precio de venta.
              precio: kind === "income" ? (p.price ?? "") : "",
            },
          ],
    );
    setBusqueda("");
  }

  const total = lineas.reduce(
    (a, l) => a + (Number(l.precio) || 0) * (Number(l.cantidad) || 0),
    0,
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const formData = new FormData(event.currentTarget);
    formData.set("kind", kind);
    formData.set("categoryId", categoryId);
    let result;
    if (conProductos && lineas.length > 0) {
      formData.set(
        "lineas",
        JSON.stringify(
          lineas.map((l) => ({
            productId: l.id,
            cantidad: Number(l.cantidad),
            precio: Number(l.precio || 0).toFixed(2),
          })),
        ),
      );
      result =
        kind === "income"
          ? await registerSaleAction(formData)
          : await registrarCompraAction(formData);
    } else {
      result = await createCashMovementAction(formData);
    }
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(result.message);
    // Una venta termina en la boleta, no cerrando el dialogo: si se cierra
    // solo, imprimirla despues obliga a buscar el movimiento en la tabla.
    // Solo la venta trae boleta; la compra y el movimiento suelto no.
    const conBoleta = result as { boleta?: DatosBoleta };
    if (conBoleta.boleta) setBoleta(conBoleta.boleta);
    else onClose();
  }

  // --- Venta ya registrada: el dialogo pasa a ser el comprobante ----------
  if (boleta) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Venta registrada</DialogTitle>
          <DialogDescription>
            Ticket N° {boleta.numero}. Así va a salir impreso.
          </DialogDescription>
        </DialogHeader>

        {/* Lo que se ve ES el documento que se imprime, al ancho real del
            papel: quien cobra sabe que va a salir antes de gastar el rollo. */}
        <VistaTicket
          boleta={boleta}
          empresa={empresa}
          moneda={moneda}
          iframeRef={ticketRef}
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Listo
          </Button>
          <Button type="button" onClick={() => imprimirTicket(ticketRef.current)}>
            <Printer className="size-4" />
            Imprimir ticket
          </Button>
        </DialogFooter>
      </>
    );
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

        {/* PASO 3: el detalle. Con productos es una lista de lineas; sin
            productos, el concepto y el monto de siempre. */}
        {paso === 3 ? (
          /* Con varios productos el contenido crecia mas que la pantalla y el
             boton de registrar quedaba fuera de alcance: la venta no se podia
             cerrar. El detalle scrollea y el pie del dialogo queda siempre
             visible. */
          <div className="grid max-h-[55vh] gap-4 overflow-y-auto pr-1">
            {conProductos ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="buscar-producto">
                    {kind === "income"
                      ? "¿Qué vendiste?"
                      : "¿Qué mercadería entró?"}
                  </Label>
                  <Input
                    id="buscar-producto"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Buscá por nombre o SKU…"
                  />
                  {busqueda.trim() !== "" ? (
                    <div className="max-h-40 overflow-y-auto rounded-md border">
                      {vendibles.slice(0, 30).map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => agregarProducto(p)}
                          className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 transition-colors hover:bg-accent"
                        >
                          <span className="truncate">{p.name}</span>
                          <span className="cifras shrink-0 text-muted-foreground">
                            {p.price ?? "sin precio"}
                          </span>
                        </button>
                      ))}
                      {vendibles.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-muted-foreground">
                          Ningún producto coincide.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {lineas.length > 0 ? (
                  <div className="grid gap-2">
                    {lineas.map((l, i) => (
                      <div
                        key={l.id}
                        className="grid gap-2 rounded-md border p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-medium">
                            {l.nombre}
                          </p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setLineas((ls) => ls.filter((x) => x.id !== l.id))
                            }
                          >
                            Quitar
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="grid gap-1">
                            <Label
                              htmlFor={`cant-${i}`}
                              className="text-xs text-muted-foreground"
                            >
                              Cantidad
                            </Label>
                            <Input
                              id={`cant-${i}`}
                              inputMode="numeric"
                              value={l.cantidad}
                              onChange={(e) =>
                                setLineas((ls) =>
                                  ls.map((x) =>
                                    x.id === l.id
                                      ? { ...x, cantidad: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </div>
                          <div className="grid gap-1">
                            <Label
                              htmlFor={`prec-${i}`}
                              className="text-xs text-muted-foreground"
                            >
                              {kind === "income"
                                ? "Precio unitario"
                                : "Costo unitario"}
                            </Label>
                            <Input
                              id={`prec-${i}`}
                              inputMode="decimal"
                              value={l.precio}
                              onChange={(e) =>
                                setLineas((ls) =>
                                  ls.map((x) =>
                                    x.id === l.id
                                      ? { ...x, precio: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    <p className="text-right text-sm">
                      Total{" "}
                      <span className="type-display cifras text-lg">
                        {total.toFixed(2)}
                      </span>
                    </p>
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                    Buscá y agregá los productos. Podés poner varios.
                  </p>
                )}

                <p className="text-xs text-muted-foreground">
                  {kind === "income"
                    ? "El precio viene del catálogo con el descuento vigente, y se puede editar."
                    : "Se suma al stock. El costo es el que pagaste, sin promedios ni supuestos."}
                </p>
              </>
            ) : (
              <>
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
              </>
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
            <Button
              type="submit"
              disabled={
                submitting ||
                categoryId === "" ||
                (conProductos && lineas.length === 0)
              }
            >
              {submitting
                ? "Registrando…"
                : conProductos
                  ? kind === "income"
                    ? "Registrar venta"
                    : "Registrar compra"
                  : "Registrar"}
            </Button>
          ) : null}
        </DialogFooter>
      </form>
    </>
  );
}
