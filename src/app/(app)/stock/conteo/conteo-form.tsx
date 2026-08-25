"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatInteger } from "@/lib/format";
import { registrarConteoAction } from "../actions";

type Producto = {
  id: string;
  sku: string;
  name: string;
  currentStock: number;
  foto: string | null;
};

/**
 * Contar el depósito sin tener que contarlo entero.
 *
 * Dos decisiones que hacen que esto sirva en la práctica:
 *
 * - **Vacío significa "no lo conté", no "hay cero".** Es la diferencia entre
 *   poder contar un estante hoy y otro el jueves, o tener que hacer el
 *   inventario completo de una sentada. Poner cero es una acción explícita.
 * - **El campo arranca vacío, no con el stock del sistema.** Si arrancara con
 *   el número actual, contar se convierte en confirmarlo, y se confirma sin
 *   mirar. El punto del conteo es justamente descubrir dónde el sistema se
 *   equivocó.
 *
 * La diferencia se muestra a medida que se escribe, para que quien cuenta note
 * el error grande -un 8 donde hay 80- en el momento y no después.
 */
export function ConteoForm({ productos }: { productos: Producto[] }) {
  const router = useRouter();
  const [contados, setContados] = useState<Record<string, string>>({});
  const [nota, setNota] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [enviando, setEnviando] = useState(false);

  const visibles = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    if (t === "") return productos;
    return productos.filter(
      (p) =>
        p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t),
    );
  }, [productos, busqueda]);

  const entradas = useMemo(
    () =>
      Object.entries(contados)
        .map(([productId, valor]) => ({ productId, valor: valor.trim() }))
        .filter((e) => e.valor !== "" && /^\d+$/.test(e.valor))
        .map((e) => ({ productId: e.productId, contado: Number(e.valor) })),
    [contados],
  );

  const conDiferencia = entradas.filter((e) => {
    const p = productos.find((x) => x.id === e.productId);
    return p ? e.contado !== p.currentStock : false;
  }).length;

  async function enviar() {
    if (enviando || entradas.length === 0) return;
    setEnviando(true);
    const r = await registrarConteoAction(entradas, nota);
    setEnviando(false);
    if (r.ok) {
      toast.success(r.message);
      setContados({});
      setNota("");
      router.refresh();
    } else {
      toast.error(r.error);
    }
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
          <Label htmlFor="nota">Nota del conteo (opcional)</Label>
          <Input
            id="nota"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="p. ej., estante de mates"
            maxLength={200}
          />
        </div>
      </div>

      <ul className="grid gap-2">
        {visibles.map((p) => {
          const valor = contados[p.id] ?? "";
          const contado = /^\d+$/.test(valor.trim())
            ? Number(valor.trim())
            : null;
          const dif = contado === null ? null : contado - p.currentStock;
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
                <p className="text-xs text-muted-foreground">Sistema</p>
                <p className="cifras text-sm">
                  {formatInteger(p.currentStock)}
                </p>
              </div>

              <div className="w-24 shrink-0">
                <Input
                  inputMode="numeric"
                  aria-label={`Contado de ${p.name}`}
                  placeholder="—"
                  value={valor}
                  onChange={(e) =>
                    setContados((c) => ({ ...c, [p.id]: e.target.value }))
                  }
                  className="text-right"
                />
              </div>

              <div className="w-20 shrink-0 text-right">
                {dif === null ? (
                  <span className="text-xs text-muted-foreground">
                    sin contar
                  </span>
                ) : dif === 0 ? (
                  <span className="text-xs text-muted-foreground">coincide</span>
                ) : (
                  <span
                    className={`cifras text-sm font-medium ${dif > 0 ? "" : "text-destructive"}`}
                  >
                    {dif > 0 ? "+" : ""}
                    {formatInteger(dif)}
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

      {/* La barra queda pegada abajo: un conteo se hace con el celular en una
          mano y el producto en la otra, y subir hasta arriba para guardar es
          justo cuando se pierde la cuenta. */}
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background p-3">
        <p className="text-sm text-muted-foreground">
          {entradas.length === 0
            ? "Todavía no contaste nada."
            : `${formatInteger(entradas.length)} ${entradas.length === 1 ? "producto contado" : "productos contados"} · ${formatInteger(conDiferencia)} con diferencia`}
        </p>
        <Button onClick={() => void enviar()} disabled={enviando || entradas.length === 0}>
          {enviando ? "Guardando…" : "Cerrar conteo"}
        </Button>
      </div>
    </div>
  );
}
