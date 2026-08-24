"use client";

import { flexRender, useTable } from "@tanstack/react-table";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  type ColumnDef,
} from "@tanstack/table-core";
import { ArrowUpDown, MoreHorizontal, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatInteger, formatMoney } from "@/lib/format";
import { isLowStock } from "@/lib/domain/stock";
import { MovementFormDialog } from "./movement-form-dialog";
import { ProductActiveDialog } from "./product-active-dialog";
import { ProductFormDialog } from "./product-form-dialog";
import type { CatalogRow, OpcionClasificacion } from "./queries";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});

const columnHelper = createColumnHelper<typeof features, CatalogRow>();

type ProductDialogState =
  { mode: "create" } | { mode: "edit"; product: CatalogRow } | null;

export function StockCatalog(props: {
  rows: CatalogRow[];
  isAdmin: boolean;
  opciones: OpcionClasificacion[];
  /** Sale de la configuracion de la instancia, nunca fijo en el codigo. */
  moneda: string;
}) {
  const { rows, isAdmin, opciones, moneda } = props;
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [productDialog, setProductDialog] = useState<ProductDialogState>(null);
  const [movementFor, setMovementFor] = useState<CatalogRow | null>(null);
  const [activeConfirm, setActiveConfirm] = useState<CatalogRow | null>(null);

  const data = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!showInactive && !row.isActive) return false;
      if (term === "") return true;
      return (
        row.sku.toLowerCase().includes(term) ||
        row.name.toLowerCase().includes(term)
      );
    });
  }, [rows, search, showInactive]);

  // Las filas traen los IDs de clasificacion, no los nombres. El mapa se arma
  // una vez y no por celda: son 34 productos hoy pero la lista llega a 150.
  const nombrePorId = useMemo(() => {
    const m = new Map<string, string>();
    for (const cat of opciones) {
      m.set(cat.id, cat.name);
      for (const sub of cat.subtypes ?? []) m.set(sub.id, sub.name);
    }
    return m;
  }, [opciones]);

  const columns = useMemo(
    () =>
      [
        columnHelper.accessor("sku", {
          header: "SKU",
          cell: (ctx) => (
            <Link
              href={`/stock/${ctx.row.original.id}`}
              className="font-mono text-xs font-medium underline-offset-4 hover:underline"
            >
              {ctx.row.original.sku}
            </Link>
          ),
        }),
        columnHelper.accessor("name", {
          header: "Nombre",
          cell: (ctx) => (
            <span
              className={
                ctx.row.original.isActive ? "" : "text-muted-foreground"
              }
            >
              {ctx.row.original.name}
            </span>
          ),
        }),
        columnHelper.accessor("currentStock", {
          header: "Stock",
          cell: (ctx) => (
            <div className="flex items-center gap-2 tabular-nums">
              {formatInteger(ctx.row.original.currentStock)}
              {isLowStock(ctx.row.original) ? (
                <Badge variant="destructive">Stock bajo</Badge>
              ) : null}
            </div>
          ),
        }),
        columnHelper.accessor("minStock", {
          header: "Mínimo",
          cell: (ctx) => (
            <span className="tabular-nums text-muted-foreground">
              {ctx.row.original.minStock === 0
                ? "Sin control"
                : formatInteger(ctx.row.original.minStock)}
            </span>
          ),
        }),
        columnHelper.accessor("price", {
          header: "Precio",
          cell: (ctx) => (
            // Un producto sin precio no se puede vender en la web: se dice,
            // no se muestra un cero que parece un precio real.
            ctx.row.original.price === null ? (
              <span className="text-muted-foreground">Sin precio</span>
            ) : (
              <span className="cifras">
                {formatMoney(ctx.row.original.price, moneda)}
              </span>
            )
          ),
        }),
        columnHelper.display({
          id: "clasificacion",
          header: "Clasificación",
          cell: (ctx) => {
            const p = ctx.row.original;
            const cat = p.categoryId ? nombrePorId.get(p.categoryId) : null;
            const sub = p.subtypeId ? nombrePorId.get(p.subtypeId) : null;
            if (!cat && !sub) {
              // Sin clasificar la web no lo puede ubicar en ningun estante.
              return <span className="text-muted-foreground">Sin clasificar</span>;
            }
            return (
              <span className="text-sm">
                {cat ?? "—"}
                {sub ? (
                  <span className="text-muted-foreground"> · {sub}</span>
                ) : null}
              </span>
            );
          },
        }),
        columnHelper.display({
          id: "fotos",
          header: "Fotos",
          cell: (ctx) => {
            const n = ctx.row.original.fotos ?? 0;
            return n === 0 ? (
              <Badge variant="secondary">Sin fotos</Badge>
            ) : (
              <span className="cifras text-muted-foreground">{n}</span>
            );
          },
        }),
        columnHelper.accessor("isActive", {
          header: "Estado",
          cell: (ctx) =>
            ctx.row.original.isActive ? (
              <Badge variant="outline">Activo</Badge>
            ) : (
              <Badge variant="secondary">Inactivo</Badge>
            ),
        }),
        columnHelper.display({
          id: "actions",
          header: "",
          cell: (ctx) => {
            const product = ctx.row.original;
            return (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Acciones">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={!product.isActive}
                    onSelect={() => setMovementFor(product)}
                  >
                    Registrar movimiento
                  </DropdownMenuItem>
                  {isAdmin ? (
                    <>
                      {/* Lleva a la MISMA ficha que el SKU, en vez de abrir un
                          dialogo con la mitad de los campos. Ahi se edita todo:
                          datos, fotos y texto de la web, y ademas se ve como
                          queda en la tienda. Dos caminos distintos para editar
                          lo mismo terminaban en dos formularios que no
                          coincidian. */}
                      <DropdownMenuItem asChild>
                        <Link href={`/stock/${product.id}`}>Editar</Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant={product.isActive ? "destructive" : "default"}
                        onSelect={() => setActiveConfirm(product)}
                      >
                        {product.isActive ? "Desactivar" : "Reactivar"}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          },
        }),
        // The helper produces per-column TValue generics (string/number/boolean)
        // that don't assign to ColumnDef<F, T, unknown>[] — standard TanStack
        // variance wart; the cast is the documented workaround.
      ] as ColumnDef<typeof features, CatalogRow>[],
    [isAdmin, moneda, nombrePorId],
  );

  const table = useTable({
    features,
    columns,
    data,
    initialState: { sorting: [{ id: "sku", desc: false }] },
  });

  const hasProducts = rows.length > 0;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por SKU o nombre…"
          className="w-full sm:max-w-xs"
        />
        <div className="flex items-center gap-2">
          <Checkbox
            id="show-inactive"
            checked={showInactive}
            onCheckedChange={(checked) => setShowInactive(checked === true)}
          />
          <Label htmlFor="show-inactive" className="text-sm font-normal">
            Ver inactivos
          </Label>
        </div>
        {isAdmin ? (
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => setProductDialog({ mode: "create" })}
          >
            <Plus className="size-4" />
            Nuevo producto
          </Button>
        ) : null}
      </div>

      {!hasProducts ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
          <p className="text-sm font-medium">Todavía no hay productos.</p>
          {isAdmin ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => setProductDialog({ mode: "create" })}
              >
                Crear producto
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link href="/importar">Importar CSV</Link>
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Un administrador puede crear productos o importarlos por CSV.
            </p>
          )}
        </div>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
          <p className="text-sm font-medium">
            Sin resultados para estos filtros.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSearch("");
              setShowInactive(true);
            }}
          >
            Limpiar filtros
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          <ArrowUpDown className="size-3 opacity-50" />
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {formatInteger(rows.filter((r) => r.isActive).length)} de 150 SKU
        activos.
      </p>

      <ProductFormDialog
        opciones={props.opciones}
        state={productDialog}
        onClose={() => setProductDialog(null)}
      />
      <MovementFormDialog
        product={movementFor}
        onClose={() => setMovementFor(null)}
      />
      <ProductActiveDialog
        product={activeConfirm}
        onClose={() => setActiveConfirm(null)}
      />
    </div>
  );
}
