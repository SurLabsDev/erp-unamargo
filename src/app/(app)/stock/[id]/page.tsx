import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PaginationLinks } from "@/components/pagination-links";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth-helpers";
import { isLowStock } from "@/lib/domain/stock";
import { formatInteger } from "@/lib/format";
import { parsePageParam } from "@/lib/params";
import { getSettings } from "@/lib/settings";
import { publicImageUrl, storageConfigured } from "@/lib/storage";
import { DetailActions } from "./detail-actions";
import { ProductContent } from "./product-content";
import { ProductImages } from "./product-images";
import { MovementsTable } from "../movements-table";
import {
  getCatalogProduct,
  listClassificationOptions,
  listMovements,
  listProductImages,
} from "../queries";

export const metadata: Metadata = { title: "Producto" };

export default async function ProductDetailPage(
  props: PageProps<"/stock/[id]">,
) {
  const user = await requireUser();
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();

  const searchParams = await props.searchParams;
  const page = parsePageParam(searchParams.page);

  const [product, settings] = await Promise.all([
    getCatalogProduct(id),
    getSettings(),
  ]);
  if (!product) notFound();

  const [movements, imagenes, opciones] = await Promise.all([
    listMovements({ productId: id, page }, settings.timezone),
    listProductImages(id),
    listClassificationOptions(),
  ]);

  return (
    <div className="grid gap-6">
      <div>
        <Link
          href="/stock"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Volver al catálogo
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-semibold tracking-tight">
                {product.sku}
              </h1>
              {isLowStock(product) ? (
                <Badge variant="destructive">Stock bajo</Badge>
              ) : null}
              {!product.isActive ? (
                <Badge variant="secondary">Inactivo</Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">{product.name}</p>
          </div>
          <DetailActions product={product} isAdmin={user.role === "admin"} />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-lg border p-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Stock actual</dt>
          <dd className="text-2xl font-semibold tabular-nums">
            {formatInteger(product.currentStock)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Stock mínimo</dt>
          <dd className="text-2xl font-semibold tabular-nums">
            {product.minStock === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              formatInteger(product.minStock)
            )}
          </dd>
          {product.minStock === 0 ? (
            <p className="text-xs text-muted-foreground">
              Sin control de alerta
            </p>
          ) : null}
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Estado</dt>
          <dd className="text-sm font-medium">
            {product.isActive ? "Activo" : "Inactivo"}
          </dd>
        </div>
      </dl>

      <ProductContent
        productId={product.id}
        price={product.price}
        description={product.description}
        categoryId={product.categoryId}
        subtypeId={product.subtypeId}
        slug={product.slug}
        currencyCode={settings.currencyCode}
        opciones={opciones}
        puedeEditar={user.role === "admin"}
      />

      <ProductImages
        productId={product.id}
        imagenes={imagenes.map((imagen, indice) => ({
          id: imagen.id,
          url: publicImageUrl(imagen.path),
          esPrincipal: indice === 0,
        }))}
        puedeEditar={user.role === "admin"}
        storageConfigurado={storageConfigured()}
      />

      <div className="grid gap-3">
        <h2 className="text-sm font-semibold">Historial de movimientos</h2>
        <MovementsTable rows={movements.rows} timezone={settings.timezone} />
        <PaginationLinks
          page={page}
          pageCount={movements.pageCount}
          total={movements.total}
          hrefFor={(p) => `/stock/${product.id}?page=${p}`}
        />
      </div>
    </div>
  );
}
