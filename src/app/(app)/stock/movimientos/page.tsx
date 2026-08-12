import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { PaginationLinks } from "@/components/pagination-links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireUser } from "@/lib/auth-helpers";
import { isValidISODate } from "@/lib/domain/dates";
import { parsePageParam, singleParam } from "@/lib/params";
import { getSettings } from "@/lib/settings";
import { MovementsTable } from "../movements-table";
import {
  listMovementFilterOptions,
  listMovements,
  type MovementFilters,
} from "../queries";

export const metadata: Metadata = { title: "Movimientos" };

const MOVEMENT_TYPES = ["in", "out", "adjustment", "initial"] as const;

const selectClassName =
  "border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export default async function MovimientosPage(
  props: PageProps<"/stock/movimientos">,
) {
  await requireUser();
  const searchParams = await props.searchParams;

  const productoParam = singleParam(searchParams.producto);
  const tipoParam = singleParam(searchParams.tipo);
  const usuarioParam = singleParam(searchParams.usuario);
  const desdeParam = singleParam(searchParams.desde);
  const hastaParam = singleParam(searchParams.hasta);

  // Untrusted params: anything malformed is treated as absent, never a 500.
  const filters: MovementFilters = {
    productId: z.uuid().safeParse(productoParam).success
      ? productoParam
      : undefined,
    type: MOVEMENT_TYPES.includes(tipoParam as never)
      ? (tipoParam as MovementFilters["type"])
      : undefined,
    userId: z.uuid().safeParse(usuarioParam).success ? usuarioParam : undefined,
    fromISO: desdeParam && isValidISODate(desdeParam) ? desdeParam : undefined,
    toISO: hastaParam && isValidISODate(hastaParam) ? hastaParam : undefined,
    page: parsePageParam(searchParams.page),
  };

  const settings = await getSettings();
  const [{ rows, total, pageCount }, { productOptions, userOptions }] =
    await Promise.all([
      listMovements(filters, settings.timezone),
      listMovementFilterOptions(),
    ]);

  const hrefFor = (page: number) => {
    const params = new URLSearchParams();
    if (filters.productId) params.set("producto", filters.productId);
    if (filters.type) params.set("tipo", filters.type);
    if (filters.userId) params.set("usuario", filters.userId);
    if (filters.fromISO) params.set("desde", filters.fromISO);
    if (filters.toISO) params.set("hasta", filters.toISO);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `/stock/movimientos?${qs}` : "/stock/movimientos";
  };

  return (
    <div className="grid gap-4">
      <div>
        <Link
          href="/stock"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Volver al catálogo
        </Link>
        <PageHeader
          title="Historial de movimientos"
          description="Ledger completo del depósito. Los movimientos no se editan ni se borran."
        />
      </div>

      <form
        method="GET"
        className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      >
        <select
          name="producto"
          defaultValue={filters.productId ?? ""}
          className={selectClassName}
          aria-label="Producto"
        >
          <option value="">Todos los productos</option>
          {productOptions.map((product) => (
            <option key={product.id} value={product.id}>
              {product.sku} — {product.name}
            </option>
          ))}
        </select>
        <select
          name="tipo"
          defaultValue={filters.type ?? ""}
          className={selectClassName}
          aria-label="Tipo"
        >
          <option value="">Todos los tipos</option>
          <option value="in">Entrada</option>
          <option value="out">Salida</option>
          <option value="adjustment">Ajuste</option>
          <option value="initial">Inicial</option>
        </select>
        <select
          name="usuario"
          defaultValue={filters.userId ?? ""}
          className={selectClassName}
          aria-label="Usuario"
        >
          <option value="">Todos los usuarios</option>
          {userOptions.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
        <Input
          type="date"
          name="desde"
          defaultValue={filters.fromISO ?? ""}
          aria-label="Desde"
        />
        <Input
          type="date"
          name="hasta"
          defaultValue={filters.toISO ?? ""}
          aria-label="Hasta"
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant="outline" className="flex-1">
            Filtrar
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/stock/movimientos">Limpiar</Link>
          </Button>
        </div>
      </form>

      {total === 0 &&
      (filters.productId || filters.type || filters.userId || filters.fromISO || filters.toISO) ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
          <p className="text-sm font-medium">Sin resultados para estos filtros.</p>
          <Button asChild size="sm" variant="outline">
            <Link href="/stock/movimientos">Limpiar filtros</Link>
          </Button>
        </div>
      ) : (
        <MovementsTable rows={rows} timezone={settings.timezone} showProduct />
      )}

      <PaginationLinks
        page={filters.page}
        pageCount={pageCount}
        total={total}
        hrefFor={hrefFor}
      />
    </div>
  );
}
