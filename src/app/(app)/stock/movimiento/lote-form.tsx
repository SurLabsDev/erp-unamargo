"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatInteger } from "@/lib/format";
import { registrarLoteAction } from "../actions";

type Producto = {
  id: string;
  sku: string;
  name: string;
  currentStock: number;
  foto: string | null;
};

/**
 * Cargar un pedido entero de una vez.
 *
 * Antes esto se hacia por el menu de tres puntos de cada fila: quince dialogos
 * para un pedido de quince articulos. Lo que pasa con una funcion asi no es que
 * la usen mal, es que dejan de usarla, y el stock del sistema se despega del
 * deposito hasta no servir para nada.
 *
 * Vacio significa "este no viene en el pedido". Solo se registran los que
 * tienen cantidad, igual que en el conteo, para que las dos pantallas se usen
 * igual y no haya que aprender dos reglas.
 *
 * En una SALIDA se muestra lo que va a quedar, y en rojo si no alcanza: mejor
 * verlo mientras se carga que descubrirlo al guardar y perder los quince.
 */
export function LoteForm({ productos }: { productos: Producto[] }) {
  const router = useRouter();
  const [tipo, setTipo] = useState<"entrada" | "salida" | null>(null);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [nota, setNota] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [enviando, setEnviando] = useState(false);

  const visibles = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    if (t === "") return productos;
    return productos.filter(
      (p) => p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t),
    );
  }, [productos, busqueda]);

  const lineas = useMemo(
    () =>
      Object.entries(cantidades)
        .map(([productId, v]) => ({ productId, v: v.trim() }))
        .filter((l) => /^\d+$/.test(l.v) && Number(l.v) > 0)
        .map((l) => ({ productId: l.productId, cantidad: Number(l.v) })),
    [cantidades],
  );

  const sinStock = lineas.filter((l) => {
    if (tipo !== "salida") return false;
    const p = productos.find((x) => x.id === l.productId);
    return p ? l.cantidad > p.currentStock : false;
  }).length;

  async function enviar() {
    if (enviando || !tipo || lineas.length === 0) return;
    setEnviando(true);
    const r = await registrarLoteAction(tipo, lineas, nota);
    setEnviando(false);
    if (r.ok) {
      toast.success(r.message);
      setCantidades({});
      setNota("");
      router.refresh();
    } else {
      toast.error(r.error);
    }
  }

  if (tipo === null) {
    return (
      <div className="grid gap-3">
        <p className="text-sm font-medium">¿Qué estás registrando?</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["entrada", "Entrada", "Llegó mercadería: una compra, una reposición"],
              ["salida", "Salida", "Se fue sin ser una venta: rotura, regalo, muestra"],
            ] as const
          ).map(([valor, titulo, ayuda]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setTipo(valor)}
              className="grid gap-1 rounded-md border p-4 text-left transition-colors hover:border-primary hover:bg-accent"
            >
              <span className="font-medium">{titulo}</span>
              <span className="text-xs text-muted-foreground">{ayuda}</span>
            </button>
          ))}
        </div>
        {/* Se aclara donde va lo que NO es esto, porque es lo que mas se va a
            buscar y esta en otra pantalla. */}
        <p className="text-xs text-muted-foreground">
          ¿Vendiste algo? Se registra desde Dinero: ahí descuenta el stock y
          anota la plata de una sola vez.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid flex-1 gap-2 sm:max-w-xs">
          <Label htmlFor="buscar">Buscar</Label>
          <Input
            id="buscar"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Nombre o SKU…"
          />
        </div>
        <div className="grid flex-1 gap-2 sm:max-w-sm">
          <Label htmlFor="nota">Nota (opcional)</Label>
          <Input
            id="nota"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder={
              tipo === "entrada" ? "p. ej., pedido de agosto" : "p. ej., rotura"
            }
            maxLength={200}
          />
        </div>
        <Button variant="outline" onClick={() => setTipo(null)}>
          Cambiar tipo
        </Button>
      </div>

      <ul className="grid gap-2">
        {visibles.map((p) => {
          const v = cantidades[p.id] ?? "";
          const cant = /^\d+$/.test(v.trim()) ? Number(v.trim()) : null;
          const queda =
            cant === null
              ? null
              : tipo === "entrada"
                ? p.currentStock + cant
                : p.currentStock - cant;
          return (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-md border p-3"
            >
              <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                {p.foto ? (
                  <Image
                    src={p.foto}
                    alt=""
                    width={56}
                    height={56}
                    className="h-full w-full object-contain p-1"
                  />
                ) : (
                  <span className="text-[10px] text-muted-foreground">
                    sin foto
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {p.sku}
                </p>
              </div>

              <div className="hidden text-right sm:block">
                <p className="text-xs text-muted-foreground">Hay</p>
                <p className="cifras text-sm">
                  {formatInteger(p.currentStock)}
                </p>
              </div>

              <div className="w-24 shrink-0">
                <Input
                  inputMode="numeric"
                  aria-label={`Cantidad de ${p.name}`}
                  placeholder="—"
                  value={v}
                  onChange={(e) =>
                    setCantidades((c) => ({ ...c, [p.id]: e.target.value }))
                  }
                  className="text-right"
                />
              </div>

              <div className="w-20 shrink-0 text-right">
                {queda === null ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  <span
                    className={`cifras text-sm ${queda < 0 ? "font-medium text-destructive" : "text-muted-foreground"}`}
                  >
                    queda {formatInteger(queda)}
                  </span>
                )}
              </div>
            </li>
          );
        })}
        {visibles.length === 0 ? (
          <li className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Ningún producto coincide con la búsqueda.
          </li>
        ) : null}
      </ul>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3">
        <p className="text-sm text-muted-foreground">
          {lineas.length === 0
            ? "Todavía no cargaste nada."
            : `${formatInteger(lineas.length)} ${lineas.length === 1 ? "producto" : "productos"}${sinStock > 0 ? ` · ${sinStock} sin stock suficiente` : ""}`}
        </p>
        <Button
          onClick={() => void enviar()}
          disabled={enviando || lineas.length === 0 || sinStock > 0}
        >
          {enviando
            ? "Registrando…"
            : tipo === "entrada"
              ? "Registrar entrada"
              : "Registrar salida"}
        </Button>
      </div>
    </div>
  );
}
